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

import { authorizeUpload } from "../../lib/upload-auth.js";

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
  const auth = await authorizeUpload(env, request, {
    token: url.searchParams.get("token") || "",
    order_id: url.searchParams.get("order_id") || "",
  });
  if (auth.error) return auth.error;
  const { order, test } = auth;

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
