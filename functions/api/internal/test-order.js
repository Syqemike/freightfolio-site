/**
 * POST /api/internal/test-order — create a disposable SYNTHETIC test order.
 *
 * Guarded by INTAKE_INTERNAL_KEY. Never linked publicly. Exists so the full
 * workspace flow (sign-in -> upload -> status -> download) can be tested
 * end-to-end without real money or real customer data.
 *
 * Body: { "internal_key": "...", "email": "test-address@example.com" }
 *
 * Creates a test:true pilot order (test: keys in KV) and attaches it to a
 * customer record, then returns the order id. Test orders never send real
 * emails (the order-store marks them test; notify paths skip sending).
 */

import { checkInternalKey, normalizeEmail, validEmail } from "../../../lib/session.js";
import { createOrderFromPayment } from "../../../lib/order-store.js";
import { attachOrderToCustomer } from "../../../lib/customer.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  if (!checkInternalKey(body.internal_key, request.headers.get("x-internal-key"), env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!env.ORDER_KV || !env.UPLOAD_TOKEN_SECRET) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return json({ ok: false, error: "bad_email" }, 400);

  const eventId = `test_evt_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const { order, created } = await createOrderFromPayment(env, {
    eventId,
    customerEmail: email,
    amountCents: 999,
    test: true,
  });
  await attachOrderToCustomer(env, email, order.order_id, { test: true });

  return json({
    ok: true,
    created,
    order_id: order.order_id,
    customer_email: email,
    test: true,
    note: "Synthetic test order. No payment, no real emails.",
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
