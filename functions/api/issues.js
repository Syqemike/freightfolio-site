/**
 * GET /api/issues — issues needing the customer's attention.
 *
 * ONLY issues actually produced by the processing pipeline (via the internal
 * status endpoint) or entered by an authorized administrator are shown.
 * Nothing is synthesized here: if the pipeline produced no issues, the list
 * is empty.
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
    for (const i of o.issues || []) {
      out.push({
        order_id: o.order_id,
        product: o.product,
        type: i.type,
        severity: i.severity,
        load: i.load,
        message: i.message,
        recommendation: i.recommendation,
        source: i.source,
        created_at: i.created_at,
      });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) ||
    (a.created_at < b.created_at ? 1 : -1));

  // Exclude dismissed issues — the customer has acknowledged them.
  const visible = out.filter((i) => !i.dismissed);

  return json({ ok: true, issues: visible });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
