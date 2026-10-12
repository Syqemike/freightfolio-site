/**
 * lib/customer.js — customer records linking Stripe-verified payments to
 * workspace access.
 *
 * Identity root is always a server-verified Stripe event (webhook). The
 * customer record is the union of a customer's pilot orders and subscription.
 *
 * KV layout:
 *   customer:{sha256(email)}   -> customer record (see below)
 *   stripe_cus:{cus_id}        -> sha256(email) (resolves subscription/invoice
 *                                 events, which carry a customer id but no email)
 *
 * Customer record:
 * {
 *   email, created_at, updated_at,
 *   orders: [order_id, ...],          // pilot orders + subscription period orders
 *   stripe_customer_ids: ["cus_..."],
 *   subscription: null | {
 *     stripe_sub_id, price_id, plan: "starter"|"business"|"premium",
 *     status: "active"|"trialing"|"past_due"|"canceled"|"incomplete"|"incomplete_expired",
 *     current_period_start: ISO, current_period_end: ISO,
 *     allowance: 100|400|1000, cancel_at_period_end: bool, updated_at: ISO
 *   }
 * }
 *
 * Subscription period orders: product "subscription", one per billing period,
 * created lazily by ensurePeriodOrder(). Files/usage for the current period
 * live on that order record, so the existing upload machinery works unchanged.
 */

import { emailHash, normalizeEmail } from "./session.js";
import {
  getOrder,
  putOrder,
  newOrderId,
  sha256HexAsync,
  DOC_ALLOWANCE_MINI_PILOT,
} from "./order-store.js";
import { createUploadToken, UPLOAD_TOKEN_TTL_SECONDS } from "./tokens.js";
import { RECOVERY_ADDON, isRecoveryAddonPrice } from "./recovery-entitlements.js";

export const PLANS = {
  starter: { name: "Starter", amount_cents: 3900, allowance: 100 },
  business: { name: "Business", amount_cents: 14900, allowance: 400 },
  premium: { name: "Premium", amount_cents: 36900, allowance: 1000 },
};

/** Map a Stripe amount (cents) to a plan key. Mirrors the stripe-watch convention. */
export function planForAmountCents(amountCents) {
  for (const [plan, cfg] of Object.entries(PLANS)) {
    if (cfg.amount_cents === amountCents) return plan;
  }
  return null;
}

export function activeSubscription(sub) {
  if (!sub) return false;
  return sub.status === "active" || sub.status === "trialing";
}

function kvKey(env, name) {
  void env;
  return name;
}

export async function getCustomer(env, email) {
  if (!env.ORDER_KV) return null;
  const h = await emailHash(email);
  const raw = await env.ORDER_KV.get(kvKey(env, `customer:${h}`));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putCustomer(env, customer) {
  const h = await emailHash(customer.email);
  customer.updated_at = new Date().toISOString();
  await env.ORDER_KV.put(kvKey(env, `customer:${h}`), JSON.stringify(customer));
}

export function newCustomerRecord(email) {
  const now = new Date().toISOString();
  return {
    email: normalizeEmail(email),
    created_at: now,
    updated_at: now,
    orders: [],
    stripe_customer_ids: [],
    subscription: null,
    test: false, // true for synthetic customers (Stripe test mode / internal test orders)
  };
}

/** Get an order regardless of live/test namespace (tries live first). */
export async function getOrderAny(env, orderId) {
  if (!orderId) return null;
  let o = await getOrder(env, orderId, { test: false });
  if (!o) o = await getOrder(env, orderId, { test: true });
  return o;
}

/**
 * Get-or-create the customer record, then attach an order id.
 * Idempotent on order id (never duplicates the entry).
 */
export async function attachOrderToCustomer(env, email, orderId, opts = {}) {
  let customer = await getCustomer(env, email);
  if (!customer) customer = newCustomerRecord(email);
  if (!customer.orders.includes(orderId)) customer.orders.push(orderId);
  if (opts.test === true) customer.test = true;
  await putCustomer(env, customer);
  return customer;
}

/** Remember stripe_customer_id -> email hash for later event resolution. */
export async function mapStripeCustomer(env, stripeCustomerId, email) {
  if (!stripeCustomerId || !env.ORDER_KV) return;
  const h = await emailHash(email);
  await env.ORDER_KV.put(kvKey(env, `stripe_cus:${stripeCustomerId}`), h, {
    expirationTtl: 400 * 24 * 60 * 60,
  });
  const customer = await getCustomer(env, email);
  if (customer && !customer.stripe_customer_ids.includes(stripeCustomerId)) {
    customer.stripe_customer_ids.push(stripeCustomerId);
    await putCustomer(env, customer);
  }
}

/** Resolve an email from a Stripe customer id (set during checkout). */
export async function emailForStripeCustomer(env, stripeCustomerId) {
  if (!stripeCustomerId || !env.ORDER_KV) return null;
  const h = await env.ORDER_KV.get(kvKey(env, `stripe_cus:${stripeCustomerId}`));
  return h || null; // returns the email hash; callers match against customer records
}

/** Full customer record for a Stripe customer id, or null when unknown. */
export async function customerForStripeCustomer(env, stripeCustomerId) {
  const h = await emailForStripeCustomer(env, stripeCustomerId);
  if (!h || !env.ORDER_KV) return null;
  const raw = await env.ORDER_KV.get(kvKey(env, `customer:${h}`));
  return raw ? JSON.parse(raw) : null;
}

/**
 * Upsert subscription state from a verified Stripe subscription object.
 * `email` may be null when the event carries no email — callers should resolve
 * via the stripe_cus mapping first. `test` marks synthetic (Stripe test mode)
 * customers so their period orders stay in the test namespace.
 */
export async function upsertSubscription(env, { email, subscription, test }) {
  if (!email) return { ok: false, error: "no_email" };
  const sub = subscription || {};
  // Defensive intercept: an add-on subscription must NEVER flow through the
  // amount-based base-plan mapping (9900 cents has no base plan and would
  // fall back to "starter"). The webhook partitions add-on items before
  // calling this; this guard catches anything that slips through.
  const subItems = (sub.items && sub.items.data) || [];
  if (subItems.some((it) => it && it.price && isRecoveryAddonPrice(it.price.id))) {
    return { ok: false, error: "addon_price_rejected" };
  }
  const price = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price) || {};
  const amount = price.unit_amount ?? null;
  const plan = planForAmountCents(amount) || "starter";
  const item = (sub.items && sub.items.data && sub.items.data[0]) || {};
  const periodStart = item.current_period_start || sub.current_period_start || null;
  const periodEnd = item.current_period_end || sub.current_period_end || null;

  let customer = await getCustomer(env, email);
  if (!customer) customer = newCustomerRecord(email);
  customer.subscription = {
    stripe_sub_id: sub.id || null,
    price_id: price.id || null,
    plan,
    status: sub.status || "unknown",
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    allowance: PLANS[plan].allowance,
    cancel_at_period_end: sub.cancel_at_period_end === true,
    updated_at: new Date().toISOString(),
  };
  if (sub.customer && !customer.stripe_customer_ids.includes(sub.customer)) {
    customer.stripe_customer_ids.push(sub.customer);
  }
  if (test === true) customer.test = true;
  await putCustomer(env, customer);
  if (sub.customer) await mapStripeCustomer(env, sub.customer, email);
  return { ok: true, customer };
}

/**
 * Ensure a period order exists for the customer's ACTIVE subscription for the
 * current billing period. Creates one lazily (product "subscription").
 * Returns the order record, or null when there is no active subscription.
 */
export async function ensurePeriodOrder(env, email) {
  const customer = await getCustomer(env, email);
  if (!customer || !activeSubscription(customer.subscription)) return null;
  const sub = customer.subscription;
  const periodKey = sub.current_period_start
    ? sub.current_period_start.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Look for an existing period order for this subscription period.
  const isTest = customer.test === true;
  for (const orderId of customer.orders) {
    const o = await getOrderAny(env, orderId);
    if (o && o.product === "subscription" && o.subscription_period === periodKey &&
        o.subscription_id === sub.stripe_sub_id) {
      return o;
    }
  }

  // Create one.
  const secret = env.UPLOAD_TOKEN_SECRET;
  if (!secret) throw new Error("UPLOAD_TOKEN_SECRET is not configured");
  const orderId = newOrderId();
  const createdAt = new Date().toISOString();
  const order = {
    order_id: orderId,
    customer_email: normalizeEmail(email),
    amount_cents: PLANS[sub.plan].amount_cents,
    product: "subscription",
    subscription_id: sub.stripe_sub_id,
    subscription_period: periodKey,
    plan: sub.plan,
    doc_allowance: sub.allowance,
    status: "paid",
    created_at: createdAt,
    upload_token: await createUploadToken(orderId, secret, UPLOAD_TOKEN_TTL_SECONDS),
    token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    storage_prefix: `orders/${orderId}`,
    stripe_event_id: null,
    files: [],
    pending: [],
    report_files: [],
    issues: [],
    test: isTest,
  };
  await putOrder(env, order, { test: isTest });
  await attachOrderToCustomer(env, email, orderId, { test: isTest });
  return order;
}

/**
 * The order a customer should upload against right now:
 * active subscription -> current period order; else latest pilot order.
 */
export async function currentUploadOrder(env, email) {
  const customer = await getCustomer(env, email);
  if (!customer) return { order: null, customer: null };
  if (activeSubscription(customer.subscription)) {
    const periodOrder = await ensurePeriodOrder(env, email);
    if (periodOrder) return { order: periodOrder, customer, kind: "subscription" };
  }
  // Latest pilot order (most recent first).
  const orders = [];
  for (const orderId of customer.orders) {
    const o = await getOrderAny(env, orderId);
    if (o) orders.push(o);
  }
  orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const pilot = orders.find((o) => o.product === "mini-pilot") || orders[0] || null;
  return { order: pilot, customer, kind: pilot ? pilot.product : null };
}

/** All orders for a customer, newest first. */
export async function listCustomerOrders(env, email) {
  const customer = await getCustomer(env, email);
  if (!customer) return [];
  const orders = [];
  for (const orderId of customer.orders) {
    const o = await getOrderAny(env, orderId);
    if (o) orders.push(o);
  }
  orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return orders;
}

/** Docs used against an order (recorded files only).
 * The legacy upload-init reservation slots (order.pending) are no longer
 * created by any live client (all uploads go through /api/upload-direct),
 * so they must not consume displayed allowance. */
export function docsUsed(order) {
  if (!order) return 0;
  return order.files ? order.files.length : 0;
}

/* ============================================================================
 * Missing-Document Recovery add-on ($99/mo) — billing core.
 *
 * The add-on lives on the customer record as customer.recovery:
 * {
 *   entitlement: "none" | "addon" | "managed_included",
 *   status: "awaiting_setup" | "active" | "paused" | "canceled" | "past_due" | "grace",
 *   stripe_addon_sub_id, addon_price_id,
 *   billing_period_start, billing_period_end,   // ISO; allowance anchors
 *   allowance: 50,                               // chase requests per period
 *   requests_used: 0,                           // monotonic counter (VM-synced)
 *   authorized_at, authorized_by,                // customer authorization
 *   setup: {},                                   // {approved, config_valid, contacts_approved, ...}
 *   reauth_required: false,
 *   grace_until, prior_status,                   // failed-payment grace bookkeeping
 *   cancel_scheduled: false, service_end_at,     // cancel-at-period-end bookkeeping
 *   canceled_at, proration_note,
 *   updated_at
 * }
 *
 * ELIGIBILITY RULE (the gate the recovery engine enforces — chasing runs ONLY
 * when ALL THREE hold):
 *   (a) recoveryEntitled(customer) is true,
 *   (b) customer authorization is complete (authorized_at set + setup.approved),
 *   (c) valid operational config + approved contacts
 *        (setup.config_valid and setup.contacts_approved are true).
 * Payment alone NEVER enables chasing: a fresh purchase sits at
 * status "awaiting_setup" until (b) and (c) are satisfied.
 *
 * GRACE / CANCEL SEMANTICS:
 *   - invoice.payment_failed -> status "past_due", grace_until = now + 7 days.
 *     Chasing CONTINUES during the 7-day grace window (recoveryEntitled()
 *     treats past_due/grace with an open grace_until as entitled).
 *   - Grace expiry -> "paused". The transition fires lazily in
 *     applyRecoveryLifecycle(), which the internal endpoints run on every
 *     call (the VM worker's periodic eligibility checks drive it; no
 *     separate cron is required).
 *   - cancel_at_period_end -> status stays "active" with cancel_scheduled=true
 *     and service_end_at=current_period_end; chasing continues until the
 *     period ends. subscription.deleted (or period end reached) -> "canceled".
 *   - Immediate delete -> "canceled" now.
 *   - invoice.paid while past_due/grace/paused -> status restored to
 *     prior_status (or "awaiting_setup" when unknown); grace cleared.
 *   - Allowance (50/mo) resets ONLY when Stripe advances current_period_start
 *     — never on plan changes, duplicate events, or out-of-order deliveries.
 *   - All writes are idempotent and converge: period bounds only ever move
 *     forward, counters are monotonic, redelivered payment_failed events do
 *     not extend grace, and duplicate invoice.paid events do not reset
 *     allowance.
 *   - A managed_included customer must NEVER be charged the add-on: every
 *     add-on write path rejects when entitlement is "managed_included".
 * ========================================================================== */

export const RECOVERY_STATUSES = [
  "awaiting_setup",
  "active",
  "paused",
  "canceled",
  "past_due",
  "grace",
];

export const RECOVERY_GRACE_DAYS = 7;

/** Blank recovery record (merged under any stored fields by getRecovery). */
export function newRecoveryRecord() {
  const now = new Date().toISOString();
  return {
    entitlement: "none",
    status: "awaiting_setup",
    stripe_addon_sub_id: null,
    addon_price_id: null,
    billing_period_start: null,
    billing_period_end: null,
    allowance: RECOVERY_ADDON.monthlyAllowance,
    requests_used: 0,
    authorized_at: null,
    authorized_by: null,
    setup: {},
    reauth_required: false,
    grace_until: null,
    prior_status: null,
    cancel_scheduled: false,
    service_end_at: null,
    canceled_at: null,
    proration_note: null,
    updated_at: now,
  };
}

/** Normalized recovery record (defaults merged under stored fields). */
export function getRecovery(customer) {
  const stored = (customer && customer.recovery) || {};
  return { ...newRecoveryRecord(), ...stored };
}

/** Merge a patch into the customer's recovery record (re-read before write). */
export async function setRecovery(env, email, patch) {
  let customer = await getCustomer(env, email);
  if (!customer) customer = newCustomerRecord(email);
  const next = { ...getRecovery(customer), ...patch, updated_at: new Date().toISOString() };
  customer.recovery = next;
  await putCustomer(env, customer);
  return next;
}

/**
 * True when the customer is entitled to the recovery service RIGHT NOW:
 * entitlement is "addon" or "managed_included" AND status is "active" or
 * "grace" (explicit), OR status is "past_due" with the 7-day grace window
 * still open (chasing continues during grace).
 *
 * NOTE: entitlement is necessary but NOT sufficient for chasing — the engine
 * must also enforce authorization + operational config (see header comment).
 */
export function recoveryEntitled(customer) {
  const rec = getRecovery(customer);
  if (rec.entitlement !== "addon" && rec.entitlement !== "managed_included") return false;
  if (rec.status === "active" || rec.status === "grace") return true;
  if (
    rec.status === "past_due" &&
    rec.grace_until &&
    new Date(rec.grace_until).getTime() > Date.now()
  ) {
    return true;
  }
  return false;
}

function isoFromUnix(ts) {
  if (!ts && ts !== 0) return null;
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

/** The add-on line item inside a Stripe subscription object, if any. */
export function addonItemFromSubscription(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  return items.find((it) => it && it.price && isRecoveryAddonPrice(it.price.id)) || null;
}

function graceUntilIso() {
  return new Date(Date.now() + RECOVERY_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Lazy lifecycle evaluation: past_due/grace with an expired grace_until ->
 * "paused"; cancel_scheduled whose service_end_at passed -> "canceled".
 * Called by the internal endpoints on every call so state converges without
 * a dedicated sweeper. Returns the (possibly transitioned) record.
 */
export async function applyRecoveryLifecycle(env, email) {
  const customer = await getCustomer(env, email);
  if (!customer || !customer.recovery) return null;
  const rec = getRecovery(customer);
  const now = Date.now();
  const patch = {};
  if (
    (rec.status === "past_due" || rec.status === "grace") &&
    rec.grace_until &&
    new Date(rec.grace_until).getTime() <= now
  ) {
    patch.status = "paused";
    patch.grace_until = null;
    // NOTE: prior_status is deliberately KEPT (not cleared) here: a later
    // invoice.paid must restore the status the customer had before the
    // payment problem (the documented "restored to prior_status" rule).
    // markRecoveryPaid clears it once the restore happens.
  }
  if (
    rec.cancel_scheduled &&
    rec.service_end_at &&
    new Date(rec.service_end_at).getTime() <= now &&
    rec.status !== "canceled"
  ) {
    patch.status = "canceled";
    patch.canceled_at = new Date().toISOString();
    patch.cancel_scheduled = false;
  }
  if (Object.keys(patch).length === 0) return rec;
  return setRecovery(env, email, patch);
}

/**
 * Create the add-on entitlement from a checkout.session.completed
 * (subscription mode, add-on price). Status is ALWAYS "awaiting_setup" —
 * payment alone never enables chasing. Idempotent on stripe sub id.
 * Rejects when the customer is managed_included (never charge the add-on).
 */
export async function createRecoveryEntitlement(
  env,
  email,
  { stripeSubId, priceId, periodStart, periodEnd, test } = {}
) {
  let customer = await getCustomer(env, email);
  if (!customer) customer = newCustomerRecord(email);
  const rec = getRecovery(customer);
  if (rec.entitlement === "managed_included") {
    return { ok: false, error: "managed_included_duplicate", customer };
  }
  if (rec.entitlement === "addon" && stripeSubId && rec.stripe_addon_sub_id === stripeSubId) {
    return { ok: true, deduped: true, customer, recovery: rec }; // redelivery
  }
  const next = {
    ...rec,
    entitlement: "addon",
    status: "awaiting_setup",
    stripe_addon_sub_id: stripeSubId || null,
    addon_price_id: priceId || RECOVERY_ADDON.priceId,
    billing_period_start: isoFromUnix(periodStart),
    billing_period_end: isoFromUnix(periodEnd),
    allowance: RECOVERY_ADDON.monthlyAllowance,
    requests_used: 0,
    // Authorization describes the customer's operational approval, not the
    // billing subscription — it survives re-purchase.
    grace_until: null,
    prior_status: null,
    cancel_scheduled: false,
    service_end_at: null,
    canceled_at: null,
    proration_note: null,
  };
  if (test === true) customer.test = true;
  customer.recovery = { ...next, updated_at: new Date().toISOString() };
  await putCustomer(env, customer);
  return { ok: true, customer, recovery: customer.recovery };
}

/**
 * Upsert add-on state from customer.subscription.created / .updated.
 * - First sight -> creates the entitlement as "awaiting_setup".
 * - Re-purchase after cancel (new sub id) -> back to "awaiting_setup".
 * - NEVER promotes "awaiting_setup" -> "active" on its own.
 * - Period bounds only move forward (out-of-order events converge).
 * - cancel_at_period_end -> stays active with cancel_scheduled; revoking the
 *   flag clears the schedule.
 */
export async function syncRecoverySubscription(env, email, sub, { test } = {}) {
  const item = addonItemFromSubscription(sub || {});
  if (!item) return { ok: false, error: "not_addon_subscription" };
  const price = item.price || {};
  const stripeStatus = (sub && sub.status) || "unknown";

  let customer = await getCustomer(env, email);
  if (!customer) customer = newCustomerRecord(email);
  const rec = getRecovery(customer);
  if (rec.entitlement === "managed_included") {
    return { ok: false, error: "managed_included_duplicate", customer };
  }

  const next = { ...rec };
  const subId = (sub && sub.id) || null;
  const isNewSub = Boolean(subId) && rec.stripe_addon_sub_id !== subId;

  if (rec.entitlement !== "addon") {
    next.entitlement = "addon";
    next.status = "awaiting_setup";
    next.allowance = RECOVERY_ADDON.monthlyAllowance;
    next.requests_used = 0;
  } else if (isNewSub && rec.status === "canceled") {
    next.status = "awaiting_setup"; // genuine re-purchase
    next.requests_used = 0;
    next.grace_until = null;
    next.prior_status = null;
    next.canceled_at = null;
  }
  if (subId) next.stripe_addon_sub_id = subId;
  if (price.id) next.addon_price_id = price.id;

  if (stripeStatus === "canceled") {
    next.status = "canceled";
    next.canceled_at = new Date().toISOString();
    next.cancel_scheduled = false;
  } else if (
    stripeStatus === "past_due" ||
    stripeStatus === "unpaid" ||
    stripeStatus === "incomplete_expired"
  ) {
    if (next.status !== "past_due" && next.status !== "grace" && next.status !== "paused") {
      next.prior_status = next.status;
      next.status = "past_due";
      next.grace_until = graceUntilIso();
    }
  } else if (stripeStatus === "active" || stripeStatus === "trialing") {
    if (sub && sub.cancel_at_period_end === true) {
      next.cancel_scheduled = true;
      const endIso = isoFromUnix(item.current_period_end || (sub && sub.current_period_end));
      if (endIso) next.service_end_at = endIso;
      // status stays as-is: service continues until the period ends.
    } else if (next.cancel_scheduled) {
      next.cancel_scheduled = false;
      next.service_end_at = null;
    }
    // Deliberately NOT promoting awaiting_setup -> active here.
  }

  // Period bounds converge forward only; usage is never reset here (only
  // invoice.paid on a period advance resets the allowance).
  const startIso = isoFromUnix(item.current_period_start || (sub && sub.current_period_start));
  const endIso = isoFromUnix(item.current_period_end || (sub && sub.current_period_end));
  if (startIso && (!next.billing_period_start || startIso > next.billing_period_start)) {
    next.billing_period_start = startIso;
  }
  if (endIso && (!next.billing_period_end || endIso > next.billing_period_end)) {
    next.billing_period_end = endIso;
  }

  if (test === true) customer.test = true;
  customer.recovery = { ...next, updated_at: new Date().toISOString() };
  await putCustomer(env, customer);
  return { ok: true, customer, recovery: customer.recovery };
}

/**
 * Mark the add-on subscription canceled (customer.subscription.deleted).
 * Scheduled cancels end service at current_period_end; immediate deletes end
 * it now (canceled_at). History (sub id, price id, periods) is kept.
 */
export async function cancelRecoveryAddon(env, email, sub, { test } = {}) {
  let customer = await getCustomer(env, email);
  if (!customer) return { ok: false, error: "no_customer" };
  const rec = getRecovery(customer);
  if (rec.entitlement !== "addon") return { ok: false, error: "no_addon_entitlement", customer };
  const subId = (sub && sub.id) || null;
  if (subId && rec.stripe_addon_sub_id && rec.stripe_addon_sub_id !== subId) {
    return { ok: false, error: "sub_mismatch", customer };
  }
  const nowIso = new Date().toISOString();
  const next = {
    ...rec,
    status: "canceled",
    canceled_at: nowIso,
    cancel_scheduled: false,
    grace_until: null,
    prior_status: null,
    service_end_at:
      rec.cancel_scheduled && rec.service_end_at ? rec.service_end_at : nowIso,
  };
  if (test === true) customer.test = true;
  customer.recovery = { ...next, updated_at: nowIso };
  await putCustomer(env, customer);
  return { ok: true, customer, recovery: customer.recovery };
}

/**
 * invoice.paid for the add-on subscription.
 * - Allowance resets ONLY when Stripe advances current_period_start
 *   (duplicate/out-of-order deliveries never reset).
 * - past_due/grace/paused -> restored to prior_status (or "awaiting_setup").
 * - A paid invoice clears a scheduled cancel (the sub is continuing).
 * - Proration: when the invoice carries prorated line items, record a
 *   proration note disclosing that Stripe prorated the first add-on charge
 *   (typical when the add-on is added mid-cycle).
 */
export async function markRecoveryPaid(
  env,
  email,
  { subId, periodStart, periodEnd, prorated, invoiceId, test } = {}
) {
  let customer = await getCustomer(env, email);
  if (!customer) return { ok: false, error: "no_customer" };
  const rec = getRecovery(customer);
  if (rec.entitlement !== "addon") return { ok: false, error: "no_addon_entitlement", customer };
  if (subId && rec.stripe_addon_sub_id && rec.stripe_addon_sub_id !== subId) {
    return { ok: false, error: "sub_mismatch", customer };
  }

  const next = { ...rec };
  const newStartIso = isoFromUnix(periodStart);
  const newEndIso = isoFromUnix(periodEnd);
  const advanced = Boolean(
    newStartIso && (!next.billing_period_start || newStartIso > next.billing_period_start)
  );
  if (advanced) {
    next.billing_period_start = newStartIso;
    next.requests_used = 0;
  }
  if (newEndIso && (!next.billing_period_end || newEndIso > next.billing_period_end)) {
    next.billing_period_end = newEndIso;
  }

  if (next.status === "past_due" || next.status === "grace" || next.status === "paused") {
    const prior = next.prior_status;
    next.status =
      prior && prior !== "past_due" && prior !== "grace" && prior !== "paused"
        ? prior
        : "awaiting_setup";
    next.prior_status = null;
    next.grace_until = null;
  }
  next.cancel_scheduled = false;
  next.service_end_at = null;

  if (prorated) {
    next.proration_note =
      "Stripe prorated this add-on charge (invoice " +
      (invoiceId || "unknown") +
      "). Proration applies when the add-on is added mid-cycle; the first " +
      "charge covers only the remainder of the current billing period.";
  }

  if (test === true) customer.test = true;
  customer.recovery = { ...next, updated_at: new Date().toISOString() };
  await putCustomer(env, customer);
  return { ok: true, customer, recovery: customer.recovery, period_advanced: advanced };
}

/**
 * invoice.payment_failed for the add-on subscription.
 * -> status "past_due", grace_until = now + 7 days (chasing continues during
 * grace). Idempotent: redeliveries do NOT extend the grace window.
 */
export async function markRecoveryPaymentFailed(env, email, { subId, test } = {}) {
  let customer = await getCustomer(env, email);
  if (!customer) return { ok: false, error: "no_customer" };
  const rec = getRecovery(customer);
  if (rec.entitlement !== "addon") return { ok: false, error: "no_addon_entitlement", customer };
  if (subId && rec.stripe_addon_sub_id && rec.stripe_addon_sub_id !== subId) {
    return { ok: false, error: "sub_mismatch", customer };
  }
  if (rec.status === "past_due" || rec.status === "grace") {
    return { ok: true, deduped: true, customer, recovery: rec };
  }
  if (rec.status === "paused" || rec.status === "canceled") {
    return { ok: true, deduped: true, customer, recovery: rec };
  }
  const next = {
    ...rec,
    prior_status: rec.status,
    status: "past_due",
    grace_until: graceUntilIso(),
  };
  if (test === true) customer.test = true;
  customer.recovery = { ...next, updated_at: new Date().toISOString() };
  await putCustomer(env, customer);
  return { ok: true, customer, recovery: customer.recovery };
}
