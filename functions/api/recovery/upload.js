/**
 * GET/POST /api/recovery/upload?t=<token> — narrowly-scoped document upload
 * for the missing-document recovery system.
 *
 * A chase email carries the recipient a link with an HMAC-signed,
 * expiring token scoped to exactly ONE requirement
 * (customer_id:order_id:requirement_id). The recipient has no workspace
 * account; the token is their only credential.
 *
 * Security properties:
 * - The token's HMAC (RECOVERY_UPLOAD_SECRET) is verified before anything
 *   else: forged or tampered tokens are rejected, expired tokens get 410.
 * - The endpoint only WRITES one file under the token's own order prefix
 *   (orders/<order_id>/<sha256>/<file>, the same SHA-256-keyed layout the
 *   bridge integrity-checks). It performs no reads, no listings, and no KV
 *   access beyond a rate-limit counter. A recipient cannot reach unrelated
 *   loads, customer files, or financial info through this link.
 * - "Requirement still open" is enforced VM-side: recovery state lives on
 *   the VM (not in KV), so the VM's ingest path re-validates the token
 *   against recovery state and rejects uploads for closed requirements.
 *   Until the VM picks the file up it is inert bytes under the order prefix.
 * - Filenames are sanitized (safeFilename) and the real type comes from
 *   magic bytes; extensions are never trusted.
 *
 * GET  ?t=<token>  -> minimal HTML upload form (after token verification).
 * POST ?t=<token>  -> multipart/form-data, field "file"; returns JSON
 *                     {ok:true, key, order_id, requirement_id, ...}.
 */
import {
  parseRecoveryTokenScope,
  verifyRecoveryUploadToken,
} from "../../../lib/recovery-tokens.js";
import { checkRateLimit } from "../../../lib/session.js";
import {
  detectFileType,
  MIME_BY_TYPE,
  objectKeyFor,
  safeFilename,
  sha256HexOfBytes,
} from "../../../lib/storage.js";
import { b2UploadBytes } from "../../../lib/b2-native.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB, same ceiling as upload-direct
const RATE_LIMIT_PER_HOUR = 20;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorPage(status, title, message) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1a1a1a">
<h1 style="font-size:22px">${title}</h1><p>${message}</p>
<p style="color:#666;font-size:14px">Freightfolio document recovery</p>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function uploadForm(token, orderId, requirementId) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload requested document</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1a1a1a">
<h1 style="font-size:22px">Upload requested document</h1>
<p>Please upload the document we asked for. PDF, JPG, or PNG, up to 25 MB.</p>
<p style="color:#666;font-size:14px">Order ${orderId} &middot; request ${requirementId}</p>
<form method="post" enctype="multipart/form-data" action="/api/recovery/upload?t=${encodeURIComponent(token)}">
<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required
style="display:block;margin:16px 0">
<button type="submit" style="background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:16px;cursor:pointer">Upload document</button>
</form>
<p style="color:#666;font-size:14px">This link is single-purpose and expires automatically. Freightfolio document recovery.</p>
</body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function verifyToken(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") || "";
  if (!token) return { ok: false, status: 400, reason: "missing_token" };
  if (!env.RECOVERY_UPLOAD_SECRET) {
    return { ok: false, status: 500, reason: "not_configured" };
  }
  const parsed = parseRecoveryTokenScope(token);
  if (!parsed.ok) return { ok: false, status: 400, reason: parsed.reason };
  // The scope is authenticated by the HMAC itself: a valid signature proves
  // the recovery system minted exactly this scope and it has not been
  // altered. The VM-side ingest re-validates against recovery state.
  const checked = await verifyRecoveryUploadToken(
    token,
    {
      customerId: parsed.customerId,
      orderId: parsed.orderId,
      requirementId: parsed.requirementId,
    },
    env.RECOVERY_UPLOAD_SECRET
  );
  if (!checked.ok) {
    const status =
      checked.reason === "expired"
        ? 410
        : checked.reason === "bad_signature"
          ? 401
          : 400;
    return { ok: false, status, reason: checked.reason };
  }
  return { ok: true, token, ...checked };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const v = await verifyToken(request, env);
  if (!v.ok) {
    if (v.status === 500)
      return errorPage(500, "Not available", "Uploads are not configured right now.");
    if (v.reason === "expired")
      return errorPage(
        410,
        "Link expired",
        "This upload link has expired. Reply to the email we sent you and we will issue a fresh one."
      );
    return errorPage(400, "Invalid link", "This upload link is not valid.");
  }
  return uploadForm(v.token, v.orderId, v.requirementId);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const v = await verifyToken(request, env);
  if (!v.ok) return json({ ok: false, error: v.reason }, v.status);

  if (!env.B2_KEY_ID || !env.B2_KEY_SECRET || !env.B2_BUCKET_ID) {
    return json({ ok: false, error: "storage_not_configured" }, 500);
  }

  // Rate-limit uploads per order so a leaked link cannot be abused for bulk.
  const rl = await checkRateLimit(env, "recovery-upload", v.orderId, RATE_LIMIT_PER_HOUR);
  if (!rl.ok) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "bad_form" }, 400);
  }
  const upload = form.get("file");
  if (!upload || typeof upload.arrayBuffer !== "function") {
    return json({ ok: false, error: "missing_file" }, 400);
  }
  const filename = safeFilename(upload.name || "file");
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

  // Magic-byte check on the actual content (extension is ignored).
  const detected = detectFileType(bytes.slice(0, 8));
  if (!detected) {
    return json({ ok: false, error: "bad_file_type", filename }, 400);
  }

  const hash = await sha256HexOfBytes(bytes);
  let key;
  try {
    key = objectKeyFor(v.orderId, hash, filename);
  } catch {
    return json({ ok: false, error: "bad_filename", filename }, 400);
  }

  try {
    await b2UploadBytes(env, {
      fileName: key,
      contentType: MIME_BY_TYPE[detected],
      bytes,
      sha256Hex: hash,
    });
  } catch (e) {
    console.error("recovery/upload: B2 upload failed", e && e.message);
    return json({ ok: false, error: "storage_error", filename }, 502);
  }

  // The file is inert bytes under the order's prefix until the VM's recovery
  // ingest picks it up (B2 prefix poll), re-validates the token against
  // recovery state, matches, validates, and reprocesses.
  return json({
    ok: true,
    key,
    order_id: v.orderId,
    requirement_id: v.requirementId,
    filename,
    size_bytes: bytes.byteLength,
    detected_type: detected,
    sha256: hash,
  });
}
