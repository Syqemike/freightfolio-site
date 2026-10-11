/**
 * Stripe webhook receiver for Freightfolio.
 * Route: POST https://freightfolio.net/api/stripe-webhook
 *
 * Verifies the Stripe signature (HMAC-SHA256, 5-min tolerance) using the
 * STRIPE_WEBHOOK_SECRET environment variable, logs verified events to the
 * EVENT_LOG KV namespace, and returns 200.
 *
 * INTAKE-SYSTEM BRANCH: on a verified `checkout.session.completed` whose
 * amount marks it as the $9.99 mini-pilot, this webhook also creates an order
 * record (lib/order-store.js) and sends the customer their upload link
 * (lib/notify.js). Idempotent on the Stripe event id: redeliveries return the
 * original order without duplicating it. Test-mode (livemode:false) events
 * create test orders only — no live data touched, no real emails sent.
 *
 * Notifications + pilot kickoff for other event types are still handled by the
 * hourly stripe-watch job on the ops side.
 */

import { createOrderFromPayment } from "../../lib/order-store.js";
import { sendPaymentConfirmed, sendOpsNewOrder, uploadLinkFor } from "../../lib/notify.js";

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

  // INTAKE-SYSTEM BRANCH: verified pilot checkout -> order record + upload link.
  // Failures here are logged but never fail the webhook (Stripe must get its
  // 200; the EVENT_LOG record above is the durable proof the event arrived,
  // and stripe-watch can reconcile later).
  let intake = null;
  if (event.type === "checkout.session.completed") {
    try {
      intake = await maybeCreatePilotOrder(env, event, request);
    } catch (e) {
      console.error("pilot order creation failed", e);
      intake = { ok: false, error: "order_failed" };
    }
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
 * If the verified session is a paid $9.99 mini-pilot checkout, create the order
 * record and send the upload-link emails. Returns null for non-pilot sessions.
 */
async function maybeCreatePilotOrder(env, event, request) {
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

  const test = event.livemode === false; // Stripe test-mode events stay in test keys

  const { order, created } = await createOrderFromPayment(env, {
    eventId: event.id || null,
    customerEmail: email,
    amountCents: PILOT_AMOUNT_CENTS,
    test,
  });

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
