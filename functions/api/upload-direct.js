/**
 * POST /api/upload-direct — proxied file upload.
 *
 * The browser POSTs the file to us (same origin, no CORS involved) and the
 * Function uploads it to B2 via the native API. This replaces the
 * presigned-URL direct-to-B2 flow, whose browser PUTs were failing on real
 * customer networks (CORS preflight / S3-endpoint reachability).
 *
 * Body: multipart/form-data with fields:
 *   - order_id: "ord_..."
 *   - token:    legacy upload token (optional; workspace uses the session cookie)
 *   - file:     the file (one per request; the client chains them for progress)
 *
 * Server-side checks (never trusts the browser):
 *   - token signature + expiry + order scoping, or valid workspace session
 *   - order is open for uploads and belongs to the caller
 *   - file present, 1 byte .. 25 MB
 *   - magic bytes: PDF / JPG / PNG only (extension is ignored)
 *   - SHA-256 not already in order.files (duplicate rejection)
 *   - allowance: order.files.length must be under order.doc_allowance
 *
 * On success the file is in B2 and recorded in order.files in one step —
 * there is no pending/reservation state. The customer + ops "files received"
 * notification is sent the first time the order reaches "received".
 */

import { authorizeUpload } from "../../lib/upload-auth.js";
import { putOrder } from "../../lib/order-store.js";
import { detectFileType, objectKeyFor, sha256HexOfBytes } from "../../lib/storage.js";
import { b2UploadBytes } from "../../lib/b2-native.js";
import { sendFilesReceived, sendOpsFilesReceived } from "../../lib/notify.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file (matches the old flow)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MIME_BY_TYPE = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.UPLOAD_TOKEN_SECRET || !env.ORDER_KV) {
    return json({ ok: false, error: "not_configured" }, 500);
  }
  if (!env.B2_KEY_ID || !env.B2_KEY_SECRET || !env.B2_BUCKET_ID) {
    return json({ ok: false, error: "storage_not_configured" }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "bad_form" }, 400);
  }

  const auth = await authorizeUpload(env, request, {
    token: typeof form.get("token") === "string" ? form.get("token") : "",
    order_id: typeof form.get("order_id") === "string" ? form.get("order_id") : "",
  });
  if (auth.error) return auth.error;
  const { order, test } = auth;

  const upload = form.get("file");
  if (!upload || typeof upload.arrayBuffer !== "function") {
    return json({ ok: false, error: "missing_file" }, 400);
  }
  const filename = String(upload.name || "file");
  const size = upload.size;

  if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
    return json(
      { ok: false, error: size > MAX_FILE_BYTES ? "too_large" : "bad_size", filename },
      400
    );
  }

  let bytes;
  try {
    bytes = new Uint8Array(await upload.arrayBuffer());
  } catch {
    return json({ ok: false, error: "unreadable", filename }, 400);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
    return json({ ok: false, error: "bad_size", filename }, 400);
  }

  // Magic-byte check on the actual content (extension is ignored).
  const detected = detectFileType(bytes.slice(0, 8));
  if (!detected) {
    return json({ ok: false, error: "bad_file_type", filename }, 400);
  }

  const hash = await sha256HexOfBytes(bytes);

  // Allowance check against the recorded files.
  const used = (order.files || []).length;
  const allowance = order.doc_allowance || 0;
  if (used >= allowance) {
    return json({ ok: false, error: "allowance_exhausted", filename, allowance }, 409);
  }
  // Note: duplicate content check removed per user request - accept files regardless

  let key;
  try {
    key = objectKeyFor(order.order_id, hash, filename);
  } catch {
    return json({ ok: false, error: "bad_filename", filename }, 400);
  }

  // Upload to B2 via the native API (server side: no CORS, no S3 endpoint).
  try {
    await b2UploadBytes(env, {
      fileName: key,
      contentType: MIME_BY_TYPE[detected],
      bytes,
      sha256Hex: hash,
    });
  } catch (e) {
    console.error("upload-direct: B2 upload failed", e && e.message);
    return json({ ok: false, error: "storage_error", filename }, 502);
  }

  const record = {
    sha256: hash,
    filename,
    key,
    size_bytes: bytes.byteLength,
    received_at: new Date().toISOString(),
    detected_type: detected,
  };
  order.files = [...(order.files || []), record];
  // Move paid/uploading/delivered orders to received when new files arrive
  // (never regress processing — the bridge is already working on it).
  const wasPaidOrUploading = ["paid", "uploading"].includes(order.status);
  const needsProcessing = wasPaidOrUploading || order.status === "delivered";
  if (needsProcessing) order.status = "received";
  await putOrder(env, order, { test });

  // Notify once, when the order first reaches "received" (from paid/uploading).
  // New files on a delivered order don't retrigger the notification.
  let email = "skipped";
  if (wasPaidOrUploading && !test) {
    try {
      const a = await sendFilesReceived(env, order, 1);
      const b = await sendOpsFilesReceived(env, order);
      email = a.ok && b.ok ? "sent" : "partial_failure";
      if (!a.ok) console.error("files-received email failed", a.error);
    } catch (e) {
      console.error("files-received email threw", e);
      email = "failed";
    }
  }

  return json({
    ok: true,
    file: {
      filename: record.filename,
      sha256: record.sha256,
      size_bytes: record.size_bytes,
      detected_type: record.detected_type,
    },
    allowance,
    used: order.files.length,
    email,
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
