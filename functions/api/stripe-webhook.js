/**
 * Stripe webhook receiver for Freightfolio.
 * Route: POST https://freightfolio.net/api/stripe-webhook
 *
 * Verifies the Stripe signature (HMAC-SHA256, 5-min tolerance) using the
 * STRIPE_WEBHOOK_SECRET environment variable, logs verified events to the
 * EVENT_LOG KV namespace, and returns 200.
 *
 * INTAKE-SYSTEM + WORKSPACE BRANCH: on verified events this webhook also:
 *   - checkout.session.completed ($9.99 pilot) -> creates an order record,
 *     attaches it to the customer record, and sends the upload-link emails.
 *   - checkout.session.completed (subscription mode) -> links the Stripe
 *     customer id to the customer record and sends the workspace invite.
 *   - customer.subscription.created/updated/deleted, invoice.paid,
 *     invoice.payment_failed -> maintains the subscription state on the
 *     customer record (plan, status, billing period).
 *   - charge.refunded -> marks the pilot order "refunded", revoking upload
 *     access (refunded is not in OPEN_STATUSES).
 *   - charge.dispute.created -> marks the order "disputed", revoking upload
 *     access until the dispute is resolved.
 * Idempotent: order creation dedupes on the Stripe event id; subscription
 * writes are natural upserts. Test-mode (livemode:false) events create test
 * records only — no live data touched, no real emails sent.
 *
 * Event types not handled here are still covered by the hourly stripe-watch
 * job on the ops side.
 */

import {
  createOrderFromPayment,
  getOrderByStripeEvent,
  getOrderByStripePI,
  claimStripeEvent,
  putOrder,
} from "../../lib/order-store.js";
import {
  sendPaymentConfirmed,
  sendOpsNewOrder,
  sendWorkspaceInvite,
  uploadLinkFor,
} from "../../lib/notify.js";
import {
  attachOrderToCustomer,
  mapStripeCustomer,
  customerForStripeCustomer,
  upsertSubscription,
  newCustomerRecord,
  putCustomer,
  getCustomer,
  createRecoveryEntitlement,
  syncRecoverySubscription,
  cancelRecoveryAddon,
  markRecoveryPaid,
  markRecoveryPaymentFailed,
  addonItemFromSubscription,
} from "../../lib/customer.js";
import { isRecoveryAddonPrice } from "../../lib/recovery-entitlements.js";

// The $9.99 mini-pilot is a one-time payment of 999 USD cents. Payment-link
// sessions surface the amount in amount_total with currency "usd".
const PILOT_AMOUNT_CENTS = 999;
const PILOT_CURRENCY = "usd";

const TOLERANCE_SECONDS = 300;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function verifySignature(rawBody, sigHeader, secret) {  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const p of sigHeader.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${t}.${rawBody}`)
  );
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, v1);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  const ok = await verifySignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) {
    return new Response(JSON.stringify({ received: false, error: "bad signature" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ received: false, error: "bad json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Durable audit log of every verified event.
  // Storage failures return 5xx so Stripe retries delivery.
  // A 200 must never be sent for an event we failed to record.
  try {
    if (!env.EVENT_LOG) {
      throw new Error("EVENT_LOG KV binding missing");
    }
    const key = `evt_${event.id || Date.now()}`;
    await env.EVENT_LOG.put(
      key,
      JSON.stringify({
        id: event.id || null,
        type: event.type || null,
        created: event.created || null,
        livemode: event.livemode || false,
        received_at: new Date().toISOString(),
        summary: summarize(event),
      })
    );
  } catch (e) {
    console.error("KV write failed", e);
    return new Response(JSON.stringify({ received: false, error: "storage failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // INTAKE-SYSTEM + WORKSPACE BRANCH: route the verified event.
  // Failures here are logged but never fail the webhook (Stripe must get its
  // 200; the EVENT_LOG record above is the durable proof the event arrived,
  // and stripe-watch can reconcile later).
  let intake = null;
  try {
    intake = await routeEvent(env, event, request);
  } catch (e) {
    console.error("event routing failed", event.type, e);
    intake = { ok: false, error: "route_failed" };
  }

  return new Response(
    JSON.stringify({ received: true, id: event.id || null, intake }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

/**
 * Route a verified Stripe event to the intake/workspace handlers.
 * Exported for unit testing. Every branch is idempotent: redeliveries of the
 * same event id produce the same state (stripe_evt dedupe for orders, natural
 * upsert for subscriptions).
 *
 * Handled types:
 *   checkout.session.completed        — pilot payment (order) or new subscription (mapping + invite)
 *   customer.subscription.created/updated — subscription state upsert
 *   customer.subscription.deleted     — subscription marked canceled
 *   invoice.paid                      — renewal: refresh period + status
 *   invoice.payment_failed            — subscription marked past_due
 *   charge.refunded                   — pilot order marked refunded (upload access revoked)
 *   charge.dispute.created            — order marked disputed (upload access revoked)
 *
 * RECOVERY ADD-ON: subscription events whose price id matches the
 * Missing-Document Recovery add-on (lib/recovery-entitlements.js) are
 * intercepted BEFORE the amount-based base-plan mapping — a 9900-cent
 * subscription never becomes a "starter" base plan — and routed to the
 * customer.recovery entitlement handlers in lib/customer.js. New purchases
 * land at status "awaiting_setup": payment alone never enables chasing.
 * All other types return { handled: false } (stripe-watch reconciles).
 */
export async function routeEvent(env, event, request) {
  const type = event.type || "";
  const obj = (event.data && event.data.object) || {};
  const test = event.livemode === false; // Stripe test-mode events stay in test keys

  switch (type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(env, event, obj, request, test);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return handleSubscriptionUpsert(env, event, obj, test);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(env, event, obj, test);
    case "invoice.paid":
      return handleInvoicePaid(env, event, obj, test);
    case "invoice.payment_failed":
      return handleInvoiceFailed(env, event, obj, test);
    case "charge.refunded":
      return handleChargeRefunded(env, event, obj, test);
    case "charge.dispute.created":
      return handleDisputeCreated(env, event, obj, test);
    default:
      return { handled: false, intake: null };
  }
}

/** Extract the customer email from a checkout session object. */
function sessionEmail(obj) {
  return (
    (obj.customer_details && obj.customer_details.email) ||
    obj.customer_email ||
    null
  );
}

/**
 * Price ids on a checkout session. Payment-link sessions do not always expand
 * line_items in the webhook payload, so also honor an explicit metadata hint
 * (metadata.recovery_addon = the add-on price id, set on the payment link).
 * This detection is best-effort: customer.subscription.created is the
 * authoritative source for the add-on entitlement.
 */
function sessionPriceIds(session) {
  const ids = [];
  const items = (session.line_items && session.line_items.data) || [];
  for (const it of items) {
    const pid = it && it.price && it.price.id;
    if (pid) ids.push(pid);
  }
  const md = session.metadata || {};
  if (md.price_id) ids.push(md.price_id);
  if (md.recovery_addon) ids.push(md.recovery_addon);
  return ids;
}

/** True when the checkout session includes the recovery add-on price. */
function sessionHasRecoveryAddon(session) {
  return sessionPriceIds(session).some(isRecoveryAddonPrice);
}

/** Split subscription items into [addonItems, baseItems]. */
function partitionSubscriptionItems(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  const addon = [];
  const base = [];
  for (const it of items) {
    const pid = it && it.price && it.price.id;
    if (isRecoveryAddonPrice(pid)) addon.push(it);
    else base.push(it);
  }
  return { addon, base };
}

/**
 * checkout.session.completed, all modes.
 *  - $9.99 one-time pilot -> order record + upload-link emails (original flow),
 *    now also attached to the customer record.
 *  - subscription mode -> link stripe customer id to email, invite to workspace.
 */
async function handleCheckoutCompleted(env, event, session, request, test) {
  const amount = session.amount_total ?? session.amount ?? null;
  const currency = (session.currency || "").toLowerCase();
  const paid = session.payment_status === "paid" || session.status === "complete";
  const email = sessionEmail(session);

  if (amount === PILOT_AMOUNT_CENTS && currency === PILOT_CURRENCY && paid) {
    return { handled: true, intake: await maybeCreatePilotOrder(env, event, request, test) };
  }

  if (session.mode === "subscription" && paid) {
    if (!email) {
      console.error("subscription session has no customer email", event.id);
      return { handled: true, intake: { ok: false, error: "no_email" } };
    }
    const stripeCustomerId = session.customer || null;
    let customer = await getCustomer(env, email);
    const isNew = !customer;
    if (isNew) customer = newCustomerRecord(email);
    if (test === true) customer.test = true;
    await putCustomer(env, customer);
    if (stripeCustomerId) await mapStripeCustomer(env, stripeCustomerId, email);

    let invite = "skipped_test_mode";
    if (!test && isNew) {
      const r = await sendWorkspaceInvite(env, email, originOf(request, env));
      invite = r.ok ? "sent" : "failed";
      if (!r.ok) console.error("workspace invite failed", r.error);
    }

    // RECOVERY ADD-ON: a subscription checkout that includes the $99/mo
    // add-on price creates the entitlement as "awaiting_setup" — payment
    // alone NEVER enables chasing (see lib/customer.js eligibility rule).
    // A managed_included customer is rejected as a duplicate purchase.
    let recovery = null;
    if (sessionHasRecoveryAddon(session)) {
      const addonIds = sessionPriceIds(session).filter(isRecoveryAddonPrice);
      const r = await createRecoveryEntitlement(env, email, {
        stripeSubId: session.subscription || null,
        priceId: addonIds[0] || null,
        periodStart: null,
        periodEnd: null,
        test,
      });
      recovery = r.ok
        ? { ok: true, status: r.recovery.status, deduped: r.deduped === true }
        : { ok: false, error: r.error };
      if (!r.ok) console.error("recovery add-on checkout rejected", event.id, r.error);
    }

    return {
      handled: true,
      intake: { ok: true, kind: "subscription_checkout", is_new_customer: isNew, invite, recovery },
    };
  }

  return { handled: false, intake: null }; // not ours — stripe-watch reconciles
}

/**
 * customer.subscription.created / .updated -> upsert subscription state.
 * Add-on items are intercepted BEFORE the amount-based base-plan mapping: a
 * 9900-cent subscription must never become a "starter" base plan. A
 * subscription can carry both (bundled base plan + add-on); each side is
 * routed independently.
 */
async function handleSubscriptionUpsert(env, event, obj, test) {
  const stripeCustomerId = obj.customer || null;
  let email = null;
  const customer = await customerForStripeCustomer(env, stripeCustomerId);
  if (customer) email = customer.email;
  if (!email) {
    console.error("subscription event has no resolvable customer", event.id, obj.id);
    return { handled: true, intake: { ok: false, error: "no_customer" } };
  }
  const { addon, base } = partitionSubscriptionItems(obj);
  let recovery = null;
  if (addon.length > 0) {
    const r = await syncRecoverySubscription(env, email, obj, { test });
    recovery = r.ok
      ? { ok: true, status: r.recovery.status }
      : { ok: false, error: r.error };
    if (!r.ok) console.error("recovery subscription upsert rejected", event.id, r.error);
  }
  let baseUpsert = null;
  if (base.length > 0) {
    const baseSub = { ...obj, items: { data: base } };
    const r = await upsertSubscription(env, { email, subscription: baseSub, test });
    baseUpsert = { ok: r.ok, error: r.error || null };
  }
  if (addon.length === 0 && base.length === 0) {
    // No items (shouldn't happen) — fall back to the legacy path so nothing
    // is silently dropped.
    const r = await upsertSubscription(env, { email, subscription: obj, test });
    baseUpsert = { ok: r.ok, error: r.error || null };
  }
  const ok = (recovery === null || recovery.ok) && (baseUpsert === null || baseUpsert.ok);
  return {
    handled: true,
    intake: { ok, kind: "subscription_upsert", test, recovery, base: baseUpsert },
  };
}

/** customer.subscription.deleted -> mark canceled (history is kept). */
async function handleSubscriptionDeleted(env, event, obj, test) {
  const stripeCustomerId = obj.customer || null;
  const customer = await customerForStripeCustomer(env, stripeCustomerId);
  if (!customer) {
    console.error("subscription.deleted has no resolvable customer", event.id, obj.id);
    return { handled: true, intake: { ok: false, error: "no_customer" } };
  }
  const { addon, base } = partitionSubscriptionItems(obj);
  // Deleted payloads sometimes omit items; also match on the stored sub id.
  const isAddonSub =
    addon.length > 0 ||
    (customer.recovery &&
      customer.recovery.stripe_addon_sub_id &&
      customer.recovery.stripe_addon_sub_id === obj.id);
  let recovery = null;
  if (isAddonSub && customer.recovery && customer.recovery.entitlement === "addon") {
    const r = await cancelRecoveryAddon(env, customer.email, obj, { test });
    recovery = r.ok ? { ok: true, status: r.recovery.status } : { ok: false, error: r.error };
  }
  let baseCanceled = null;
  if (base.length > 0 || !isAddonSub) {
    const baseSub = { ...obj, status: "canceled", items: { data: base } };
    const r = await upsertSubscription(env, {
      email: customer.email,
      subscription: baseSub,
      test,
    });
    baseCanceled = { ok: r.ok, error: r.error || null };
  }
  const ok = (recovery === null || recovery.ok) && (baseCanceled === null || baseCanceled.ok);
  return {
    handled: true,
    intake: { ok, kind: "subscription_canceled", test, recovery, base: baseCanceled },
  };
}

/**
 * invoice.paid -> renewal: refresh subscription period from the invoice lines.
 * Add-on lines are routed to the recovery entitlement (allowance resets ONLY
 * when Stripe advances current_period_start — never on plan changes or
 * duplicate events); base-plan lines keep the legacy path. A bundled invoice
 * updates both sides.
 */
async function handleInvoicePaid(env, event, obj, test) {
  const stripeCustomerId = obj.customer || null;
  const subId = obj.subscription || null;
  if (!subId) return { handled: false, intake: null }; // one-off invoice — not ours
  let email = obj.customer_email || null;
  if (!email) {
    const customer = await customerForStripeCustomer(env, stripeCustomerId);
    if (customer) email = customer.email;
  }
  // Repair the mapping when the invoice carries the email.
  if (email && stripeCustomerId) await mapStripeCustomer(env, stripeCustomerId, email);
  if (!email) {
    console.error("invoice.paid has no resolvable customer", event.id, obj.id);
    return { handled: true, intake: { ok: false, error: "no_customer" } };
  }

  const lines = (obj.lines && obj.lines.data) || [];
  const addonLines = lines.filter((l) => l && l.price && isRecoveryAddonPrice(l.price.id));
  const baseLines = lines.filter((l) => !l || !l.price || !isRecoveryAddonPrice(l.price && l.price.id));
  const prorated = lines.some((l) => l && l.proration === true);

  let recovery = null;
  if (addonLines.length > 0) {
    const line = addonLines[0];
    const r = await markRecoveryPaid(env, email, {
      subId,
      periodStart: line.period ? line.period.start : obj.period_start,
      periodEnd: line.period ? line.period.end : obj.period_end,
      prorated,
      invoiceId: obj.id || null,
      test,
    });
    recovery = r.ok
      ? { ok: true, status: r.recovery.status, period_advanced: r.period_advanced }
      : { ok: false, error: r.error };
    if (!r.ok) console.error("recovery invoice.paid rejected", event.id, r.error);
  }

  let basePaid = null;
  if (baseLines.length > 0) {
    const line = baseLines[0];
    const price = line.price || {};
    const r = await upsertSubscription(env, {
      email,
      subscription: {
        id: subId,
        customer: stripeCustomerId,
        status: "active",
        items: {
          data: [
            {
              price,
              current_period_start: line.period ? line.period.start : obj.period_start,
              current_period_end: line.period ? line.period.end : obj.period_end,
            },
          ],
        },
        cancel_at_period_end: false,
      },
      test,
    });
    basePaid = { ok: r.ok, error: r.error || null };
  }

  if (addonLines.length === 0 && baseLines.length === 0) {
    return { handled: false, intake: null }; // no usable lines — stripe-watch reconciles
  }
  const ok = (recovery === null || recovery.ok) && (basePaid === null || basePaid.ok);
  return { handled: true, intake: { ok, kind: "invoice_paid", test, recovery, base: basePaid } };
}

/**
 * invoice.payment_failed -> past_due (+ 7-day grace for the add-on; chasing
 * continues during grace). Routed by subscription id: add-on sub -> recovery
 * entitlement, base sub -> legacy base subscription. Idempotent: redeliveries
 * do not extend the grace window.
 */
async function handleInvoiceFailed(env, event, obj, test) {
  const stripeCustomerId = obj.customer || null;
  const subId = obj.subscription || null;
  if (!subId) return { handled: false, intake: null };
  const customer = await customerForStripeCustomer(env, stripeCustomerId);
  if (!customer) {
    console.error("invoice.payment_failed has no resolvable subscription", event.id, obj.id);
    return { handled: true, intake: { ok: false, error: "no_customer" } };
  }
  const isAddonSub =
    customer.recovery &&
    customer.recovery.entitlement === "addon" &&
    customer.recovery.stripe_addon_sub_id === subId;
  if (isAddonSub) {
    const r = await markRecoveryPaymentFailed(env, customer.email, { subId, test });
    return {
      handled: true,
      intake: {
        ok: r.ok,
        kind: "payment_failed",
        test,
        recovery: r.ok ? { ok: true, status: r.recovery.status } : { ok: false, error: r.error },
      },
    };
  }
  if (!customer.subscription) {
    console.error("invoice.payment_failed has no resolvable subscription", event.id, obj.id);
    return { handled: true, intake: { ok: false, error: "no_customer" } };
  }
  customer.subscription.status = "past_due";
  customer.subscription.updated_at = new Date().toISOString();
  await putCustomer(env, customer);
  return { handled: true, intake: { ok: true, kind: "payment_failed", test } };
}

/**
 * charge.refunded -> revoke the order's upload access.
 * A refunded pilot order must not retain paid upload/processing access.
 * Sets status to "refunded" (not in OPEN_STATUSES, so upload-init rejects
 * with 409). Idempotent: redeliveries of the same event are no-ops.
 * Subscription-invoice refunds are flagged for manual review instead of
 * auto-canceling, since a refund does not always mean the subscription ends.
 */
async function handleChargeRefunded(env, event, obj, test) {
  const paymentIntentId = obj.payment_intent || null;
  const chargeId = obj.id || null;
  // Idempotency on the Stripe event id.
  const already = await getOrderByStripeEvent(env, event.id, { test });
  if (already && already.status === "refunded") {
    return { handled: true, intake: { ok: true, kind: "charge_refunded", deduped: true } };
  }
  const order = await getOrderByStripePI(env, paymentIntentId, { test });
  if (!order) {
    // May be a subscription invoice refund or an order predating the
    // payment-intent mapping; stripe-watch reconciles, ops reviews manually.
    console.error("charge.refunded: no order for payment_intent", paymentIntentId, chargeId);
    return { handled: true, intake: { ok: false, error: "no_order", charge: chargeId } };
  }
  if (order.status !== "refunded") {
    order.status = "refunded";
    order.refunded_at = new Date().toISOString();
    order.refund_charge = chargeId;
    await putOrder(env, order, { test });
  }
  // Record the event id so redeliveries dedupe.
  await claimStripeEvent(env, event.id, order.order_id, { test });
  return { handled: true, intake: { ok: true, kind: "charge_refunded", order_id: order.order_id } };
}

/**
 * charge.dispute.created -> flag the order as disputed.
 * Like refunds, a disputed (chargeback) order loses upload access until
 * the dispute is resolved. Status "disputed" is not in OPEN_STATUSES.
 */
async function handleDisputeCreated(env, event, obj, test) {
  const chargeId = obj.charge || null;
  const already = await getOrderByStripeEvent(env, event.id, { test });
  if (already && already.status === "disputed") {
    return { handled: true, intake: { ok: true, kind: "dispute_created", deduped: true } };
  }
  // Best-effort: match via payment intent if the dispute carries it.
  const paymentIntentId = obj.payment_intent || null;
  const order = await getOrderByStripePI(env, paymentIntentId, { test });
  if (!order) {
    console.error("charge.dispute.created: no order for dispute", event.id, chargeId);
    return { handled: true, intake: { ok: false, error: "no_order", charge: chargeId } };
  }
  if (order.status !== "disputed") {
    order.status = "disputed";
    order.disputed_at = new Date().toISOString();
    order.dispute_charge = chargeId;
    await putOrder(env, order, { test });
  }
  await claimStripeEvent(env, event.id, order.order_id, { test });
  return { handled: true, intake: { ok: true, kind: "dispute_created", order_id: order.order_id } };
}
/**
 * If the verified session is a paid $9.99 mini-pilot checkout, create the order
 * record, attach it to the customer record, and send the upload-link emails.
 * Idempotent on the Stripe event id (redeliveries return the original order).
 */
async function maybeCreatePilotOrder(env, event, request, test) {
  const session = (event.data && event.data.object) || {};
  const amount = session.amount_total ?? session.amount ?? null;
  const currency = (session.currency || "").toLowerCase();
  const paid =
    session.payment_status === "paid" || session.status === "complete";

  if (amount !== PILOT_AMOUNT_CENTS || currency !== PILOT_CURRENCY || !paid) {
    return null; // not a pilot payment — leave it to stripe-watch
  }

  const email =
    (session.customer_details && session.customer_details.email) ||
    session.customer_email ||
    null;
  if (!email) {
    console.error("pilot session has no customer email", event.id);
    return { ok: false, error: "no_email" };
  }

  const { order, created } = await createOrderFromPayment(env, {
    eventId: event.id || null,
    customerEmail: email,
    amountCents: PILOT_AMOUNT_CENTS,
    paymentIntentId: session.payment_intent || null,
    test,
  });

  // Attach the order to the customer record (identity root for workspace login).
  await attachOrderToCustomer(env, email, order.order_id, { test });

  if (!created) {
    return { ok: true, created: false, order_id: order.order_id }; // redelivery — deduped
  }

  let emailStatus = "skipped_test_mode";
  if (!test) {
    const origin = originOf(request, env);
    const a = await sendPaymentConfirmed(env, order, origin);
    const b = await sendOpsNewOrder(env, order, origin);
    emailStatus = a.ok && b.ok ? "sent" : "partial_failure";
    if (!a.ok) console.error("payment-confirmed email failed", a.error);
    if (!b.ok) console.error("ops new-order email failed", b.error);
  }
  return {
    ok: true,
    created: true,
    order_id: order.order_id,
    upload_link: test ? null : uploadLinkFor(order, originOf(request, env)),
    email: emailStatus,
  };
}
function originOf(request, env) {
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN;
  try {
    const u = new URL(request.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://freightfolio.net";
  }
}

function summarize(event) {
  try {
    const o = event.data && event.data.object ? event.data.object : {};
    return {
      amount: o.amount_total ?? o.amount ?? null,
      currency: o.currency || null,
      customer_email:
        (o.customer_details && o.customer_details.email) || o.customer_email || null,
      payment_status: o.payment_status || o.status || null,
    };
  } catch {
    return {};
  }
}

// Explicitly reject non-POST to keep the surface tight.
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
