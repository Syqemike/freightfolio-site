/**
 * POST /api/internal/status — processing status sync from the ops bridge.
 *
 * Guarded by INTAKE_INTERNAL_KEY (constant-time compare; header x-internal-key
 * or JSON body field internal_key). Never linked publicly.
 *
 * Body:
 *   {
 *     "internal_key": "...",
 *     "order_id": "ord_...",
 *     "status": "received" | "processing" | "needs_attention" | "delivered",
 *     "report_files": [ { "key": "orders/<order_id>/report/...", "name": "...", "size_bytes": 123 } ],
 *     "issues": [ { "type": "...", "severity": "low|medium|high", "load": "...",
 *                   "message": "...", "recommendation": "...", "source": "pipeline" } ],
 *     "note": "optional ops note"
 *   }
 *
 * Only honest statuses are accepted. report_files keys are constrained to the
 * order's own prefix. Issues are stored verbatim (they must come from the real
 * pipeline run — this endpoint cannot verify that, so the key itself is the
 * trust boundary and is never exposed to browsers).
 */

import { checkInternalKey } from "../../../lib/session.js";
import { updateOrderStatus } from "../../../lib/order-store.js";

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

  const result = await updateOrderStatus(env, orderId, {
    status: body.status,
    report_files: body.report_files,
    issues: body.issues,
    note: body.note,
  });
  if (!result.ok) return json(result, 400);
  return json(result);
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
