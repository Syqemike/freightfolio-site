/**
 * POST /api/internal/expire-files — retention sweep hook.
 *
 * Guarded by INTAKE_INTERNAL_KEY (constant-time compare; header x-internal-key
 * or JSON body field internal_key). Never linked publicly.
 *
 * Body:
 *   {
 *     "internal_key": "...",
 *     "order_id": "ord_...",
 *     "keys": ["orders/<order_id>/...", ...]
 *   }
 *
 * Removes the listed object keys from the order's files[] and report_files[]
 * records after the retention sweeper has deleted them from B2. Keys are
 * constrained to the order's own prefix; anything else is ignored.
 */

import { checkInternalKey } from "../../../lib/session.js";
import { getOrder, putOrder, sha256HexAsync } from "../../../lib/order-store.js";

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
  if (!env.ORDER_KV) return json({ ok: false, error: "not_configured" }, 500);

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!orderId) return json({ ok: false, error: "missing_order_id" }, 400);
  const prefix = `orders/${orderId}/`;
  const keys = new Set(
    (Array.isArray(body.keys) ? body.keys : []).filter(
      (k) => typeof k === "string" && k.startsWith(prefix)
    )
  );

  let order = await getOrder(env, orderId, { test: false });
  let test = false;
  if (!order) {
    order = await getOrder(env, orderId, { test: true });
    test = true;
  }
  if (!order) return json({ ok: false, error: "unknown_order" }, 400);

  const beforeFiles = (order.files || []).length;
  const beforeReports = (order.report_files || []).length;
  order.files = (order.files || []).filter((f) => !keys.has(f.key));
  order.report_files = (order.report_files || []).filter((f) => !keys.has(f.key));
  const removedFiles = beforeFiles - order.files.length;
  const removedReports = beforeReports - order.report_files.length;

  // Full cleanup: when the order has no files or reports left, delete the
  // entire order record and its lookup mappings (email index, Stripe event
  // and payment-intent mappings). Otherwise the KV accumulates orphaned
  // metadata for orders whose B2 objects are long gone.
  let orderDeleted = false;
  if (order.files.length === 0 && order.report_files.length === 0) {
    const kv = env.ORDER_KV;
    const nsPrefix = test ? "test:" : "";
    // Delete the order record itself.
    await kv.delete(`${nsPrefix}order:${orderId}`);
    // Delete the payment-intent mapping if present.
    if (order.stripe_payment_intent) {
      await kv.delete(`${nsPrefix}stripe_pi:${order.stripe_payment_intent}`);
    }
    // Delete the Stripe event mapping if present.
    if (order.stripe_event_id) {
      await kv.delete(`${nsPrefix}stripe_evt:${order.stripe_event_id}`);
    }
    // Remove this order from the email index array (keep other orders).
    if (order.customer_email) {
      const emailHash = await sha256HexAsync(
        order.customer_email.trim().toLowerCase());
      const emailKey = `${nsPrefix}email:${emailHash}`;
      try {
        const raw = await kv.get(emailKey);
        if (raw) {
          let ids;
          try {
            const parsed = JSON.parse(raw);
            ids = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            ids = [raw];
          }
          ids = ids.filter((id) => id !== orderId);
          if (ids.length === 0) {
            await kv.delete(emailKey);
          } else {
            await kv.put(emailKey, JSON.stringify(ids));
          }
        }
      } catch {
        // Best effort; a stale index entry is harmless.
      }
    }
    orderDeleted = true;
  } else {
    await putOrder(env, order, { test });
  }

  return json({
    ok: true,
    removed_files: removedFiles,
    removed_reports: removedReports,
    order_deleted: orderDeleted,
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
