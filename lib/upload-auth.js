/**
 * lib/upload-auth.js — authorize upload API calls by EITHER the legacy HMAC
 * upload token OR a workspace session cookie.
 *
 * Token path is byte-for-byte the original behavior (see upload-init.js):
 *   - missing token/order_id -> 401 missing_token
 *   - unknown order          -> 404 unknown_order
 *   - bad/expired token      -> 401 invalid_token / 410 expired
 *
 * Session path (workspace):
 *   - no session cookie / bad signature / expired -> 401 unauthorized
 *   - session email does not own the order  -> 403 forbidden
 *   - unknown order                         -> 404 unknown_order
 *
 * Both paths enforce the same order-state rule: status must be one that still
 * accepts files (paid/uploading/received). Customers upload throughout their
 * billing period; the processing bridge picks up whatever is in storage.
 * All allowance/duplicate/type/size enforcement downstream is unchanged.
 */

import { verifyUploadToken } from "./tokens.js";
import { getOrder } from "./order-store.js";
import { getSession } from "./session.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function resolveOrder(env, orderId) {
  if (!orderId) return { order: null, test: false };
  let order = await getOrder(env, orderId, { test: false });
  let test = false;
  if (!order) {
    order = await getOrder(env, orderId, { test: true });
    test = true;
  }
  return { order, test };
}

const OPEN_STATUSES = new Set(["paid", "uploading", "received", "delivered"]);

function checkOpen(order) {
  // Orders accept uploads throughout the billing period, even if a previous
  // batch was delivered. The bridge picks up new files and moves the order
  // back to "received". The allowance check in upload-direct.js prevents
  // overuse.
  if (!OPEN_STATUSES.has(order.status)) {
    return { error: json({ ok: false, error: "order_not_open", status: order.status }, 409) };
  }
  return null;
}

/**
 * Authorize an upload API call.
 * @param {object} env
 * @param {Request} request
 * @param {{token?:string, order_id?:string}} params
 * @returns {Promise<{order, test, via}|{error:Response}>}
 */
export async function authorizeUpload(env, request, params) {
  const token = typeof params.token === "string" ? params.token : "";
  const orderId = typeof params.order_id === "string" ? params.order_id : "";

  // --- Path 1: legacy HMAC upload token (original behavior preserved) ---
  if (token) {
    if (!orderId) return { error: json({ ok: false, error: "missing_token" }, 401) };
    const { order, test } = await resolveOrder(env, orderId);
    if (!order) return { error: json({ ok: false, error: "unknown_order" }, 404) };
    const v = await verifyUploadToken(token, orderId, env.UPLOAD_TOKEN_SECRET);
    if (!v.ok) {
      const status = v.reason === "expired" ? 410 : 401;
      return { error: json({ ok: false, error: "invalid_token", reason: v.reason }, status) };
    }
    const open = checkOpen(order);
    if (open) return open;
    return { order, test, via: "token" };
  }

  // --- Path 2: workspace session cookie ---
  if (!orderId) return { error: json({ ok: false, error: "missing_token" }, 401) };
  const session = await getSession(request, env);
  if (!session) return { error: json({ ok: false, error: "unauthorized" }, 401) };
  const { order, test } = await resolveOrder(env, orderId);
  if (!order) return { error: json({ ok: false, error: "unknown_order" }, 404) };
  if (order.customer_email !== session.email) {
    return { error: json({ ok: false, error: "forbidden" }, 403) };
  }
  const open = checkOpen(order);
  if (open) return open;
  return { order, test, via: "session", session };
}
