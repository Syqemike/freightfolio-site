/**
 * lib/b2-native.js — Backblaze B2 native API client for server-side uploads.
 *
 * Used by POST /api/upload-direct so the browser never talks to B2 directly.
 * That sidesteps CORS preflight failures and S3-endpoint reachability issues
 * on customer networks: the browser only ever talks to freightfolio.net,
 * and the Function talks to api.backblazeb2.com (B2's primary API).
 *
 * Requires env: B2_KEY_ID, B2_KEY_SECRET, B2_BUCKET_ID.
 */

const AUTH_URL = "https://api.backblazeb2.com/b2api/v3/b2_authorize_account";

// Cache the auth token in-module (B2 tokens are valid 24h; we refresh after 20h).
let authCache = null; // { apiUrl, authToken, downloadUrl, accountId, keyId, expiresAt }

function b64(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export async function b2Authorize(env) {
  const keyId = env.B2_KEY_ID || "";
  const secret = env.B2_KEY_SECRET || "";
  if (!keyId || !secret) throw new Error("b2_not_configured");
  const now = Date.now();
  if (authCache && authCache.keyId === keyId && authCache.expiresAt > now) {
    return authCache;
  }
  const res = await fetch(AUTH_URL, {
    headers: { Authorization: "Basic " + b64(new TextEncoder().encode(keyId + ":" + secret)) },
  });
  if (!res.ok) {
    authCache = null;
    throw new Error("b2_authorize_failed:" + res.status);
  }
  const d = await res.json();
  authCache = {
    apiUrl: d.apiInfo.storageApi.apiUrl,
    authToken: d.authorizationToken,
    downloadUrl: d.apiInfo.storageApi.downloadUrl,
    accountId: d.accountId,
    keyId,
    expiresAt: now + 20 * 3600 * 1000,
  };
  return authCache;
}

async function b2Api(env, method, payload) {
  const { apiUrl, authToken } = await b2Authorize(env);
  const res = await fetch(`${apiUrl}/b2api/v3/${method}`, {
    method: "POST",
    headers: { Authorization: authToken, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`b2_${method}_failed:${res.status}`);
    err.b2 = body;
    throw err;
  }
  return body;
}

/**
 * Upload raw bytes to B2. Returns the B2 file info { fileId, fileName, ... }.
 * fileName must already be a safe object key (e.g. orders/ord_xxx/<sha>/<name>).
 */
export async function b2UploadBytes(env, { fileName, contentType, bytes, sha256Hex }) {
  const bucketId = env.B2_BUCKET_ID || "";
  if (!bucketId) throw new Error("b2_bucket_id_missing");
  if (!fileName || !String(fileName).startsWith("orders/ord_")) {
    throw new Error("b2_bad_key");
  }
  const u = await b2Api(env, "b2_get_upload_url", { bucketId });
  if (!u.uploadUrl || !u.authorizationToken) throw new Error("b2_no_upload_url");

  // X-Bz-File-Name must be URL-encoded; our keys are already URL-safe.
  const encodedName = String(fileName)
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");

  // B2 REQUIRES the file's SHA-1 checksum header (it rejects the upload without it).
  const sha1Hex = await sha1HexOf(bytes);

  const res = await fetch(u.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: u.authorizationToken,
      "X-Bz-File-Name": encodedName,
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "X-Bz-Content-Sha1": sha1Hex,
      "X-Bz-Content-Sha256": sha256Hex,
    },
    body: bytes,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`b2_upload_failed:${res.status}`);
    err.b2 = body;
    throw err;
  }
  return body;
}

async function sha1HexOf(bytes) {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Test helper: clear the cached auth token. */
export function _clearB2AuthCache() {
  authCache = null;
}
