/**
 * GET /api/admin/batch?order_id=<id> — full batch detail for the admin console.
 * Admin session only. Includes files, pending slots, reports, issues, ops notes.
 */

import { json, requireAdmin } from "../../../lib/api-auth.js";
import { getOrder } from "../../../lib/order-store.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;

  const orderId = new URL(request.url).searchParams.get("order_id") || "";
  if (!orderId) return json({ ok: false, error: "missing_order_id" }, 400);

  let order = await getOrder(env, orderId, { test: false });
  if (!order) order = await getOrder(env, orderId, { test: true });
  if (!order) return json({ ok: false, error: "unknown_order" }, 404);

  return json({ ok: true, order });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
