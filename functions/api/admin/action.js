/**
 * POST /api/admin/action — perform an admin action on a batch.
 * Admin session only. Every action is written to the KV audit log.
 *
 * Body: { "order_id": "...", "action": "set_status" | "add_note" | "add_issue" | "resend_notification",
 *         "status": "...", "note": "...", "issue": {...} }
 *
 * - set_status: honest statuses only (received|processing|needs_attention|delivered).
 * - add_note: appends an ops note to the order.
 * - add_issue: appends a genuine admin-entered issue (source "admin").
 * - resend_notification: re-sends the files-received emails (customer + ops).
 */

import { json, requireAdmin } from "../../../lib/api-auth.js";
import { getOrder, putOrder, logAdminAction } from "../../../lib/order-store.js";
import { sendFilesReceived, sendOpsFilesReceived } from "../../../lib/notify.js";

const HONEST_STATUSES = new Set(["received", "processing", "needs_attention", "delivered"]);

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!orderId || !action) return json({ ok: false, error: "missing_params" }, 400);

  let order = await getOrder(env, orderId, { test: false });
  let test = false;
  if (!order) {
    order = await getOrder(env, orderId, { test: true });
    test = true;
  }
  if (!order) return json({ ok: false, error: "unknown_order" }, 404);

  let detail = "";
  if (action === "set_status") {
    const status = typeof body.status === "string" ? body.status : "";
    if (!HONEST_STATUSES.has(status)) return json({ ok: false, error: "bad_status" }, 400);
    order.status = status;
    if (status === "delivered") order.delivered_at = new Date().toISOString();
    detail = `status -> ${status}`;
  } else if (action === "add_note") {
    const note = String(body.note || "").slice(0, 500);
    if (!note) return json({ ok: false, error: "missing_note" }, 400);
    order.ops_notes = order.ops_notes || [];
    order.ops_notes.push({ at: new Date().toISOString(), note, by: session.email });
    detail = `note added (${note.length} chars)`;
  } else if (action === "add_issue") {
    const i = body.issue || {};
    const message = String(i.message || "").slice(0, 500);
    if (!message) return json({ ok: false, error: "missing_issue" }, 400);
    order.issues = order.issues || [];
    order.issues.push({
      type: String(i.type || "note").slice(0, 40),
      severity: ["low", "medium", "high"].includes(i.severity) ? i.severity : "medium",
      load: String(i.load || "").slice(0, 80),
      message,
      recommendation: String(i.recommendation || "").slice(0, 500),
      source: "admin",
      created_at: new Date().toISOString(),
    });
    detail = `admin issue added: ${message.slice(0, 80)}`;
  } else if (action === "resend_notification") {
    if (test) return json({ ok: false, error: "test_order_no_email" }, 400);
    const a = await sendFilesReceived(env, order, (order.files || []).length);
    const b = await sendOpsFilesReceived(env, order);
    detail = `notifications resent (customer:${a.ok}, ops:${b.ok})`;
    if (!a.ok || !b.ok) return json({ ok: false, error: "send_failed", detail }, 503);
  } else {
    return json({ ok: false, error: "unknown_action" }, 400);
  }

  await putOrder(env, order, { test });
  await logAdminAction(env, {
    actor: session.email,
    action,
    target: orderId,
    detail,
  });

  return json({ ok: true, order_id: orderId, action, status: order.status, detail });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
