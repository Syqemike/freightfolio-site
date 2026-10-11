/**
 * GET /api/reports/download?order_id=<id>&file=<name>
 *
 * Authorizes a single report download: the session email must own the order,
 * and the file must be a report recorded on that order. Responds with a 302
 * redirect to a short-lived (15-minute) presigned B2 URL. The B2 credentials
 * never leave the server.
 */

import { json, requireSession } from "../../../lib/api-auth.js";
import { getOrder } from "../../../lib/order-store.js";
import { presignedGetUrl } from "../../../lib/storage.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id") || "";
  const file = url.searchParams.get("file") || "";
  if (!orderId || !file) return json({ ok: false, error: "missing_params" }, 400);

  let order = await getOrder(env, orderId, { test: false });
  if (!order) order = await getOrder(env, orderId, { test: true });
  if (!order) return json({ ok: false, error: "unknown_order" }, 404);
  if (order.customer_email !== session.email) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const report = (order.report_files || []).find((r) => r.name === file);
  if (!report) return json({ ok: false, error: "unknown_report" }, 404);

  let dl;
  try {
    dl = await presignedGetUrl(env, { key: report.key, expiresSeconds: 900 });
  } catch (e) {
    console.error("presign download failed", e);
    return json({ ok: false, error: "storage_unavailable" }, 503);
  }
  return Response.redirect(dl, 302);
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
