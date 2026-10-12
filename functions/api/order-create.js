/**
 * POST /api/order-create — create an order record from a VERIFIED Stripe payment.
 *
 * This endpoint is NOT called by browsers. It is invoked server-side either:
 *   (1) by the extended stripe-webhook (same deployment, direct function import), or
 *   (2) by the hourly stripe-watch cron on the ops VM, which has already verified
 *       the charge state via the Stripe API.
 *
 * It NEVER trusts query params or browser redirects as proof of payment.
 *
 * Auth: requires header "x-intake-key" matching the INTAKE_INTERNAL_KEY env var.
 *
 * Body (JSON):
 *   { event_id, customer_email, amount_cents, product, test? }
 *
 * Test mode (test: true): all KV keys are prefixed "test:", the order is marked
 * test:true, and no live customer data is touched. Used by synthetic e2e checks.
 *
 * On success (201): creates the order, sends the payment-confirmed + upload-link
 * email to the customer and an ops notification. Email failures are logged but do
 * not fail the order (the order record is the source of truth; emails can be resent).
 */

import { createOrderFromPayment } from "../../lib/order-store.js";
import { getCustomer, putCustomer, newCustomerRecord } from "../../lib/customer.js";
import { sendPaymentConfirmed, sendOpsNewOrder, sendWorkspaceInvite } from "../../lib/notify.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function originOf(request, env) {
  // Prefer the configured public origin; fall back to the request origin.
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN;
  try {
    const u = new URL(request.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://freightfolio.net";
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const internalKey = env.INTAKE_INTERNAL_KEY;
  if (!internalKey) {
    return json({ ok: false, error: "not_configured" }, 500);
  }
  const provided = request.headers.get("x-intake-key") || "";
  // Timing-safe compare on the gate key.
  let diff = provided.length === internalKey.length ? 0 : 1;
  const n = Math.max(provided.length, internalKey.length);
  for (let i = 0; i < n; i++) {
    diff |= (provided.charCodeAt(i) || 0) ^ (internalKey.charCodeAt(i) || 0);
  }
  if (diff !== 0) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const payment = {
    eventId: typeof body.event_id === "string" && body.event_id ? body.event_id : null,
    customerEmail: body.customer_email,
    amountCents: body.amount_cents,
    test: body.test === true,
  };

  if (body.product && body.product !== "mini-pilot") {
    return json({ ok: false, error: "unsupported_product" }, 400);
  }

  let result;
  try {
    result = await createOrderFromPayment(env, payment);
  } catch (e) {
    console.error("order-create failed", e);
    const msg = String(e.message || "");
    const clientError =
      msg.includes("invalid") || msg.includes("UPLOAD_TOKEN_SECRET") || msg.includes("ORDER_KV");
    return json(
      { ok: false, error: clientError ? "invalid_payment" : "internal", detail: clientError ? msg : undefined },
      clientError ? 400 : 500
    );
  }

  // Idempotent repeat: same Stripe event -> return the original order, no new email.
  if (!result.created) {
    return json({ ok: true, created: false, order_id: result.order.order_id });
  }

  const order = result.order;
  const origin = originOf(request, env);
  let emailStatus = "skipped";
  if (!order.test) {
    const a = await sendPaymentConfirmed(env, order, origin);
    const b = await sendOpsNewOrder(env, order, origin);
    // EM-05: new customers on this path also get the workspace invite
    // (the Stripe-checkout webhook path already does this).
    let invite = "skipped_existing_customer";
    const existingCustomer = await getCustomer(env, order.customer_email);
    if (!existingCustomer) {
      const customer = newCustomerRecord(order.customer_email);
      await putCustomer(env, customer);
      const r = await sendWorkspaceInvite(env, order.customer_email, origin);
      invite = r.ok ? "sent" : "failed";
      if (!r.ok) console.error("workspace invite failed", r.error);
    }
    emailStatus = a.ok && b.ok ? "sent" : "partial_failure";
    if (!a.ok) console.error("payment-confirmed email failed", a.error);
    if (!b.ok) console.error("ops new-order email failed", b.error);
  } else {
    emailStatus = "skipped_test_mode";
  }

  return json(
    {
      ok: true,
      created: true,
      order_id: order.order_id,
      token_expires_at: order.token_expires_at,
      email: emailStatus,
    },
    201
  );
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
