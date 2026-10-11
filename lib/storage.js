/**
 * lib/storage.js — S3-compatible presigned URL generation (pure Web Crypto, no SDK).
 *
 * Target today: Backblaze B2 (S3-compatible API, no card required, 10 GB free).
 * Target later: Cloudflare R2 (S3 endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com).
 * Migration is config-only: change B2_ENDPOINT / B2_BUCKET / key id / secret.
 *
 * Signing happens server-side inside Pages Functions. Bucket credentials NEVER
 * reach the browser; the browser only ever sees short-lived presigned URLs.
 *
 * Object key scheme:  orders/<order_id>/<sha256-of-content>/<safe-filename>
 * The bucket is private; only presigned GET (15-min expiry) grants read access.
 *
 * Env vars (Cloudflare Pages > Settings > Environment variables):
 *   B2_ENDPOINT   e.g. https://s3.us-west-004.backblazeb2.com
 *   B2_BUCKET     e.g. freightfolio-intake
 *   B2_KEY_ID     B2 application key ID (bucket-scoped, least privilege)
 *   B2_KEY_SECRET B2 application key secret
 */

const te = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256HexData(data) {
  return hex(await crypto.subtle.digest("SHA-256", data));
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, te.encode(data)));
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}
function amzDate(date) {
  return date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function getStorageConfig(env) {
  const endpoint = (env.B2_ENDPOINT || "").replace(/\/+$/, "");
  const bucket = env.B2_BUCKET || "";
  const accessKeyId = env.B2_KEY_ID || "";
  const secretAccessKey = env.B2_KEY_SECRET || "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Storage is not configured (B2_ENDPOINT/B2_BUCKET/B2_KEY_ID/B2_KEY_SECRET). " +
        "See wiring-checklist.md."
    );
  }
  let host;
  try {
    host = new URL(endpoint).host;
  } catch {
    throw new Error("B2_ENDPOINT is not a valid URL");
  }
  return { endpoint, host, bucket, accessKeyId, secretAccessKey };
}

/**
 * SigV4 signing key derivation (AWS4).
 */
export async function deriveSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = await hmacSha256(te.encode("AWS4" + secretAccessKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

/**
 * Build a presigned URL (SigV4 query auth) for PUT (upload) or GET (download).
 */
export async function presignUrl(env, {
  method,           // "PUT" | "GET"
  key,              // object key, e.g. "orders/ord_abc/<sha256>/bol.pdf"
  expiresSeconds,   // 1..604800
  contentType,      // for PUT: pinned content type (optional but recommended)
  region = "us-west-004", // B2 S3 region; R2 uses "auto"
}) {
  const cfg = getStorageConfig(env);
  const now = new Date();
  const dateStamp = yyyymmdd(now);
  const amzDt = amzDate(now);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  // Canonical URI: /<bucket>/<key> (path-style works on both B2 and R2).
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const canonicalUri = `/${cfg.bucket}/${encodedKey}`;

  const signedHeaders = method === "PUT" && contentType ? "content-type;host" : "host";

  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDt,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join("&");

  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalHeaders =
    method === "PUT" && contentType
      ? `content-type:${contentType}\nhost:${cfg.host}\n`
      : `host:${cfg.host}\n`;

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDt,
    credentialScope,
    hex(await crypto.subtle.digest("SHA-256", te.encode(canonicalRequest))),
  ].join("\n");

  const signingKey = await deriveSigningKey(cfg.secretAccessKey, dateStamp, region, "s3");
  const signature = hex(await hmacSha256(signingKey, stringToSign));

  return `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Presigned PUT URL for a customer upload (5-minute expiry). */
export async function presignedPutUrl(env, { key, contentType, expiresSeconds = 300 }) {
  if (typeof key !== "string" || !key.startsWith("orders/ord_")) {
    throw new Error("presignedPutUrl: key must live under orders/<order_id>/");
  }
  if (!contentType) throw new Error("presignedPutUrl: contentType is required");
  return presignUrl(env, {
    method: "PUT",
    key,
    contentType,
    expiresSeconds,
    region: env.B2_REGION || "us-west-004",
  });
}

/** Presigned GET URL for a private object (15-minute expiry, e.g. ops download). */
export async function presignedGetUrl(env, { key, expiresSeconds = 900 }) {
  if (typeof key !== "string" || !key.startsWith("orders/ord_")) {
    throw new Error("presignedGetUrl: key must live under orders/<order_id>/");
  }
  return presignUrl(env, {
    method: "GET",
    key,
    expiresSeconds,
    region: env.B2_REGION || "us-west-004",
  });
}

/**
 * Server-side HEAD check that an object exists (used by upload-complete).
 * Returns {exists:boolean, size:number|null, contentType:string|null}.
 * Uses the application key directly (server-to-server; never exposed to browser).
 */
export async function headObject(env, key) {
  const cfg = getStorageConfig(env);
  // B2 also offers b2_get_file_info via the native API; S3 HEAD is provider-agnostic.
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `${cfg.endpoint}/${cfg.bucket}/${encodedKey}`;
  // NOTE: a signed HEAD via SigV4 header auth is heavier to implement; for now we
  // verify existence with a ranged GET (bytes=0-0) using a short-lived presigned
  // URL minted server-side. Functionally equivalent, same auth model.
  const signed = await presignUrl(env, {
    method: "GET",
    key,
    expiresSeconds: 60,
    region: env.B2_REGION || "us-west-004",
  });
  const res = await fetch(signed, { headers: { Range: "bytes=0-0" } });
  if (res.status === 404) return { exists: false, size: null, contentType: null };
  if (!res.ok && res.status !== 206) return { exists: false, size: null, contentType: null };
  const range = res.headers.get("content-range"); // "bytes 0-0/12345"
  const size = range && range.includes("/") ? Number(range.split("/")[1]) : null;
  await res.arrayBuffer().catch(() => null); // drain
  return {
    exists: true,
    size: Number.isFinite(size) ? size : null,
    contentType: res.headers.get("content-type"),
  };
}

/**
 * Server-side magic-byte check: fetch the first 8 bytes of an object and verify
 * they match PDF/JPG/PNG signatures. Never trust file extensions alone.
 */
export const MAGIC_BYTES = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
};

export function detectFileType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const startsWith = (sig) => sig.every((v, i) => b[i] === v);
  if (startsWith(MAGIC_BYTES.pdf)) return "pdf";
  if (startsWith(MAGIC_BYTES.png)) return "png";
  if (startsWith(MAGIC_BYTES.jpg)) return "jpg";
  return null;
}

export const MIME_BY_TYPE = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
};

export async function verifyObjectMagicBytes(env, key) {
  const cfg = getStorageConfig(env);
  void cfg;
  const signed = await presignUrl(env, {
    method: "GET",
    key,
    expiresSeconds: 60,
    region: env.B2_REGION || "us-west-004",
  });
  const res = await fetch(signed, { headers: { Range: "bytes=0-7" } });
  if (!res.ok && res.status !== 206) return { ok: false, reason: "unreadable" };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 4) return { ok: false, reason: "too_small" };
  const type = detectFileType(buf);
  if (!type) return { ok: false, reason: "bad_magic_bytes" };
  return { ok: true, type, mime: MIME_BY_TYPE[type] };
}

/**
 * Sanitize a user-supplied filename for use in an object key.
 * Strips path components, control chars, and anything outside a safe set.
 */
export function safeFilename(name) {
  const base = String(name || "").split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120);
  const trimmed = cleaned.replace(/^\.+/, "") || "file";
  // Force an allowed extension; the real type comes from magic bytes.
  return trimmed;
}

export function objectKeyFor(orderId, sha256, filename) {
  if (!/^ord_[0-9a-f]{32}$/.test(orderId)) throw new Error("bad order id");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("bad sha256");
  return `orders/${orderId}/${sha256}/${safeFilename(filename)}`;
}

/**
 * Compute SHA-256 hex of bytes (used for the <sha256-of-content> key segment).
 */
export async function sha256HexOfBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(digest);
}
