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
import { getOrder, putOrder } from "../../../lib/order-store.js";

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
  await putOrder(env, order, { test });

  return json({
    ok: true,
    removed_files: beforeFiles - order.files.length,
    removed_reports: beforeReports - order.report_files.length,
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
