/**
 * lib/tokens.js — HMAC-signed upload tokens for the Freightfolio mini-pilot intake flow.
 *
 * Token format:  ord_<orderIdB64url>.<expUnixB64url>.<sigB64url>
 * where sig = HMAC_SHA256(UPLOAD_TOKEN_SECRET, "<orderId>.<expUnix>")
 *
 * Properties:
 * - Unguessable: the order id itself is 128-bit crypto-random; the HMAC binds it
 *   to an expiry so tokens cannot be forged or extended without the secret.
 * - Single-order scoping: a token is only valid for the order id embedded in it;
 *   cross-order reuse is rejected at verification time.
 * - Constant-time signature comparison to resist timing oracles.
 *
 * Works in Cloudflare Workers/Pages (Web Crypto) and in Node 18+ (same API).
 */

const te = new TextEncoder();

function b64urlEncode(bytes) {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function hmacHex(secret, data) {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(data));
  return new Uint8Array(sig);
}

/** Constant-time byte comparison. */
export function timingSafeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

export const UPLOAD_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Create a signed upload token for an order.
 * @param {string} orderId  the crypto-random order id (e.g. "ord_a3f9...")
 * @param {string} secret   UPLOAD_TOKEN_SECRET (env)
 * @param {number} [ttlSeconds] token lifetime; defaults to 7 days
 * @returns {Promise<string>} the token string
 */
export async function createUploadToken(orderId, secret, ttlSeconds = UPLOAD_TOKEN_TTL_SECONDS) {
  if (!orderId || !secret) throw new Error("createUploadToken: orderId and secret are required");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${orderId}.${exp}`;
  const sig = await hmacHex(secret, body);
  return `ord_${b64urlEncode(te.encode(orderId))}.${b64urlEncode(te.encode(String(exp)))}.${b64urlEncode(sig)}`;
}

/**
 * Verify a token against the expected order id and secret.
 * @param {string} token
 * @param {string} orderId  the order id the caller expects (from the order record, never from the token alone)
 * @param {string} secret   UPLOAD_TOKEN_SECRET (env)
 * @param {number} [nowSeconds]
 * @returns {Promise<{ok:true, orderId:string, exp:number} | {ok:false, reason:string}>}
 */
export async function verifyUploadToken(token, orderId, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || !token.startsWith("ord_")) {
    return { ok: false, reason: "malformed" };
  }
  if (!secret) return { ok: false, reason: "secret_missing" };
  const parts = token.slice(4).split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let tokenOrderId, expStr;
  try {
    tokenOrderId = new TextDecoder().decode(b64urlDecode(parts[0]));
    expStr = new TextDecoder().decode(b64urlDecode(parts[1]));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };

  // Single-order scoping: the token must belong to THIS order.
  if (tokenOrderId !== orderId) return { ok: false, reason: "order_mismatch" };

  if (exp <= nowSeconds) return { ok: false, reason: "expired" };

  const expectedSig = await hmacHex(secret, `${orderId}.${exp}`);
  let providedSig;
  try {
    providedSig = b64urlDecode(parts[2]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqualBytes(expectedSig, providedSig)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, orderId, exp };
}
