/**
 * GET /api/files — document history for the signed-in customer.
 *
 * Query params: order_id (optional, default all), q (filename search),
 *               status (received|processing|needs_attention|completed|all),
 *               limit (default 100, max 500)
 *
 * Only files from orders owned by the session email are returned.
 * Statuses shown are the order's actual status — never invented.
 */

import { json, requireSession } from "../../lib/api-auth.js";
import { listCustomerOrders } from "../../lib/customer.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  const url = new URL(request.url);
  const orderFilter = url.searchParams.get("order_id") || "";
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const statusFilter = (url.searchParams.get("status") || "all").toLowerCase();
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10) || 100));

  const orders = await listCustomerOrders(env, session.email);
  const out = [];
  for (const o of orders) {
    if (orderFilter && o.order_id !== orderFilter) continue;
    if (statusFilter !== "all" && o.status !== statusFilter) continue;
    for (const f of o.files || []) {
      if (q && !String(f.filename || "").toLowerCase().includes(q)) continue;
      out.push({
        order_id: o.order_id,
        product: o.product,
        filename: f.filename,
        size_bytes: f.size_bytes,
        received_at: f.received_at,
        detected_type: f.detected_type || null,
        status: o.status, // the file's status is its order's actual status
      });
    }
  }
  out.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));

  return json({ ok: true, files: out.slice(0, limit), total: out.length });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
