/**
 * GET /api/admin/batches — list order batches for the admin console.
 * Admin session only (freightfolio.ops@gmail.com).
 * Query: limit (default 50, max 100). Pagination across the two namespaces
 * (live + synthetic test orders) is intentionally simple: both prefixes are
 * listed and merged, newest first. Test orders are badged in the UI.
 */

import { json, requireAdmin } from "../../../lib/api-auth.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));

  const batches = [];
  for (const prefix of ["order:", "test:order:"]) {
    const listed = await env.ORDER_KV.list({ prefix, limit });
    for (const k of listed.keys) {
      const raw = await env.ORDER_KV.get(k.name);
      if (!raw) continue;
      try {
        const o = JSON.parse(raw);
        batches.push({
          order_id: o.order_id,
          customer_email: o.customer_email,
          product: o.product,
          plan: o.plan || null,
          status: o.status,
          created_at: o.created_at,
          delivered_at: o.delivered_at || null,
          files: (o.files || []).length,
          reports: (o.report_files || []).length,
          issues: (o.issues || []).length,
          test: o.test === true,
        });
      } catch {
        // skip corrupt records
      }
    }
  }
  batches.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return json({ ok: true, batches: batches.slice(0, limit) });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
