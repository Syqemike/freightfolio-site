/**
 * POST /api/upload-init — mint presigned PUT URLs for a customer's files.
 *
 * Body (JSON):
 *   {
 *     "token": "<upload token from the ?t= URL>",
 *     "order_id": "<order id>",
 *     "files": [ { "filename": "...", "content_type": "application/pdf|image/jpeg|image/png",
 *                  "size_bytes": 12345, "sha256": "<64 hex chars of the file content>" } ]
 *   }
 *
 * Server-side enforcement (never trusts the browser):
 *   - token signature + expiry + order scoping (lib/tokens.js)
 *   - order exists, status is paid/uploading, token not expired
 *   - doc allowance: received + pending + requested <= doc_allowance (10 for pilot)
 *   - per-file: size <= 25 MB, content_type in the allowlist, sha256 format valid,
 *     filename sanitized, duplicate content (sha256) rejected
 *   - each accepted file reserves a slot in order.pending (concurrent uploads
 *     cannot exceed the allowance)
 *
 * Returns 200 { ok:true, uploads:[ { sha256, filename, key, put_url, expires_in, required_content_type } ] }
 * or 4xx with { ok:false, error, ... } (per-file rejections are listed individually).
 */

import { verifyUploadToken } from "../../lib/tokens.js";
import { getOrder, putOrder } from "../../lib/order-store.js";
import { presignedPutUrl, objectKeyFor, MIME_BY_TYPE } from "../../lib/storage.js";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const PUT_URL_TTL_SECONDS = 300; // 5 minutes

const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const TYPE_BY_MIME = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadAndAuthorize(env, body) {
  const token = typeof body.token === "string" ? body.token : "";
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!token || !orderId) return { error: json({ ok: false, error: "missing_token" }, 401) };

  const order = await getOrder(env, orderId, { test: false });
  const testOrder = order ? null : await getOrder(env, orderId, { test: true });
  const resolved = order || testOrder;
  if (!resolved) return { error: json({ ok: false, error: "unknown_order" }, 404) };

  const v = await verifyUploadToken(token, orderId, env.UPLOAD_TOKEN_SECRET);
  if (!v.ok) {
    const status = v.reason === "expired" ? 410 : 401;
    return { error: json({ ok: false, error: "invalid_token", reason: v.reason }, status) };
  }
  if (resolved.status !== "paid" && resolved.status !== "uploading") {
    return { error: json({ ok: false, error: "order_not_open", status: resolved.status }, 409) };
  }
  return { order: resolved, test: !order };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.UPLOAD_TOKEN_SECRET) return json({ ok: false, error: "not_configured" }, 500);
  if (!env.ORDER_KV) return json({ ok: false, error: "not_configured" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const auth = await loadAndAuthorize(env, body);
  if (auth.error) return auth.error;
  const { order, test } = auth;

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) return json({ ok: false, error: "no_files" }, 400);
  // Sanity cap against abusive payloads; the real allowance rule is enforced
  // per-file below (files beyond the remaining allowance are individually
  // rejected with "allowance_exceeded", never silently dropped).
  if (files.length > 50) {
    return json({ ok: false, error: "too_many_files", max: 50 }, 400);
  }

  const used = order.files.length + order.pending.length;
  const remaining = order.doc_allowance - used;
  if (remaining <= 0) {
    return json({ ok: false, error: "allowance_exhausted", allowance: order.doc_allowance }, 409);
  }

  const seenInBatch = new Set();
  const accepted = [];
  const rejected = [];
  const knownHashes = new Set([
    ...order.files.map((f) => f.sha256),
    ...order.pending.map((p) => p.sha256),
  ]);

  for (const f of files.slice(0, remaining)) {
    const filename = typeof f.filename === "string" ? f.filename : "";
    const contentType = typeof f.content_type === "string" ? f.content_type.toLowerCase() : "";
    const size = f.size_bytes;
    const sha256 = typeof f.sha256 === "string" ? f.sha256.toLowerCase() : "";

    const rej = (reason) => rejected.push({ filename: filename || "(unnamed)", reason });

    if (!filename) {
      rej("missing_filename");
      continue;
    }
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      rej("unsupported_type");
      continue;
    }
    if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
      rej(size > MAX_FILE_BYTES ? "too_large" : "bad_size");
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      rej("bad_sha256");
      continue;
    }
    if (knownHashes.has(sha256) || seenInBatch.has(sha256)) {
      rej("duplicate_content");
      continue;
    }
    seenInBatch.add(sha256);

    let key;
    try {
      key = objectKeyFor(order.order_id, sha256, filename);
    } catch {
      rej("bad_filename");
      continue;
    }
    accepted.push({ sha256, filename, key, contentType, size_bytes: size });
  }

  // The 11th-file rule: files beyond the remaining allowance are rejected, not silently dropped.
  const overflow = files.slice(remaining);
  for (const f of overflow) {
    rejected.push({ filename: (f && f.filename) || "(unnamed)", reason: "allowance_exceeded" });
  }

  const uploads = [];
  for (const a of accepted) {
    let putUrl;
    try {
      putUrl = await presignedPutUrl(env, {
        key: a.key,
        contentType: a.contentType,
        expiresSeconds: PUT_URL_TTL_SECONDS,
      });
    } catch (e) {
      console.error("presign failed", e);
      rejected.push({ filename: a.filename, reason: "storage_unavailable" });
      continue;
    }
    uploads.push({
      sha256: a.sha256,
      filename: a.filename,
      key: a.key,
      put_url: putUrl,
      expires_in: PUT_URL_TTL_SECONDS,
      required_content_type: a.contentType,
      expected_type: TYPE_BY_MIME[a.contentType],
    });
    // Reserve the slot so concurrent uploads cannot exceed the allowance.
    order.pending.push({
      sha256: a.sha256,
      key: a.key,
      filename: a.filename,
      reserved_at: new Date().toISOString(),
    });
  }

  if (uploads.length > 0) {
    order.status = "uploading";
    await putOrder(env, order, { test });
  }

  return json({
    ok: true,
    order_id: order.order_id,
    allowance: order.doc_allowance,
    remaining_after: order.doc_allowance - order.files.length - order.pending.length,
    uploads,
    rejected,
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
