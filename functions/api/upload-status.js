/**
 * GET /api/upload-status — validate an upload token and report order state.
 *
 * Query: ?token=<upload token>&order_id=<order id>
 *
 * Used by upload.html on page load to show a friendly "link valid / expired /
 * already completed" state before the customer picks files. Read-only; the
 * token is verified server-side exactly as in upload-init.
 *
 * Returns 200 { ok:true, order_id, status, allowance, received_count,
 *   token_expires_at, test } or 4xx { ok:false, error, reason? }.
 */

import { verifyUploadToken } from "../../lib/tokens.js";
import { getOrder } from "../../lib/order-store.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.UPLOAD_TOKEN_SECRET || !env.ORDER_KV) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const orderId = url.searchParams.get("order_id") || "";
  if (!token || !orderId) return json({ ok: false, error: "missing_token" }, 400);

  let order = await getOrder(env, orderId, { test: false });
  let test = false;
  if (!order) {
    order = await getOrder(env, orderId, { test: true });
    test = true;
  }
  if (!order) return json({ ok: false, error: "unknown_order" }, 404);

  const v = await verifyUploadToken(token, orderId, env.UPLOAD_TOKEN_SECRET);
  if (!v.ok) {
    const status = v.reason === "expired" ? 410 : 401;
    return json({ ok: false, error: "invalid_token", reason: v.reason }, status);
  }

  return json({
    ok: true,
    order_id: order.order_id,
    status: order.status,
    allowance: order.doc_allowance,
    received_count: order.files.length,
    token_expires_at: order.token_expires_at,
    test,
  });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
