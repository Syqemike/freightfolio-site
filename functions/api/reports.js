/**
 * GET /api/reports — list the customer's completed reports.
 *
 * Reports are recorded on the order by the processing bridge via the internal
 * status endpoint (only after the report file was actually uploaded to B2).
 * An honest empty list is returned before the first report is ready.
 */

import { json, requireSession } from "../../lib/api-auth.js";
import { listCustomerOrders } from "../../lib/customer.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  const orders = await listCustomerOrders(env, session.email);
  const out = [];
  for (const o of orders) {
    for (const r of o.report_files || []) {
      out.push({
        order_id: o.order_id,
        product: o.product,
        plan: o.plan || null,
        name: r.name,
        size_bytes: r.size_bytes,
        completed_at: r.uploaded_at,
      });
    }
  }
  out.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));

  return json({ ok: true, reports: out });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
