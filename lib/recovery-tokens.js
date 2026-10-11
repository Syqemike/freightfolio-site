/**
 * lib/recovery-tokens.js — HMAC-signed recovery upload tokens (verify side).
 *
 * Python mirror: hidden_files/recovery/src/upload_tokens.py (mint + verify).
 * The VM mints these tokens; this module only verifies them at the site
 * endpoint. The mint side never runs here.
 *
 * Token format:  rcv_<scopeB64url>.<expUnixB64url>.<sigB64url>
 * where scope = "<customer_id>:<order_id>:<requirement_id>"
 * and   sig   = HMAC_SHA256(RECOVERY_UPLOAD_SECRET, "<scope>.<expUnix>")
 *
 * Properties (same as lib/tokens.js, narrower scope):
 * - Unguessable: the HMAC binds scope to expiry; tokens cannot be forged or
 *   extended without the secret.
 * - Single-requirement scoping: a token authorizes uploads for exactly one
 *   requirement of one order of one customer. Cross-customer, cross-order,
 *   and cross-requirement reuse is rejected at verification time.
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
  const padded = String(s).replace(/-/g, "+").replace(/_/g, "/");
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

async function hmacBytes(secret, data) {
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

export const RECOVERY_TOKEN_PREFIX = "rcv_";
export const RECOVERY_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Decode (not verify) a token's embedded scope. Diagnostics only: never
 * trust the returned scope for authorization without verifyRecoveryUploadToken.
 */
export function parseRecoveryTokenScope(token) {
  if (typeof token !== "string" || !token.startsWith(RECOVERY_TOKEN_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.slice(RECOVERY_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let scope, expStr;
  try {
    scope = new TextDecoder().decode(b64urlDecode(parts[0]));
    expStr = new TextDecoder().decode(b64urlDecode(parts[1]));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  const scopeParts = scope.split(":");
  if (scopeParts.length !== 3 || scopeParts.some((p) => !p)) {
    return { ok: false, reason: "malformed" };
  }
  const [customerId, orderId, requirementId] = scopeParts;
  if (!/^ord_[0-9a-f]{32}$/.test(orderId)) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, customerId, orderId, requirementId, exp };
}

/**
 * Verify a recovery upload token.
 *
 * @param {string} token            the rcv_ token from the query string
 * @param {{customerId:string, orderId:string, requirementId:string}} expected
 *   the scope the caller expects. At the upload endpoint this comes from the
 *   token's own authenticated scope (parsed then HMAC-verified below), which
 *   is safe because the HMAC is what authenticates it; the VM-side ingest
 *   re-validates the token against the requirement in recovery state before
 *   the file is ever trusted.
 * @param {string} secret           RECOVERY_UPLOAD_SECRET (env)
 * @param {number} [nowSeconds]
 * @returns {Promise<{ok:true, customerId, orderId, requirementId, exp} |
 *                    {ok:false, reason:string}>}
 */
export async function verifyRecoveryUploadToken(
  token,
  expected,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  if (typeof token !== "string" || !token.startsWith(RECOVERY_TOKEN_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }
  if (!secret) return { ok: false, reason: "secret_missing" };
  const parts = token.slice(RECOVERY_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let tokenScope, expStr;
  try {
    tokenScope = new TextDecoder().decode(b64urlDecode(parts[0]));
    expStr = new TextDecoder().decode(b64urlDecode(parts[1]));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };

  // Narrow scoping: the token must belong to exactly this requirement of
  // this customer and order. A token minted for one customer can never open
  // another customer's loads, files, or financial info.
  const expectedScope =
    `${expected.customerId}:${expected.orderId}:${expected.requirementId}`;
  const scopeBytes = te.encode(tokenScope);
  const expectedBytes = te.encode(expectedScope);
  if (!timingSafeEqualBytes(scopeBytes, expectedBytes)) {
    return { ok: false, reason: "scope_mismatch" };
  }

  if (exp <= nowSeconds) return { ok: false, reason: "expired" };

  const expectedSig = await hmacBytes(secret, `${expectedScope}.${exp}`);
  let providedSig;
  try {
    providedSig = b64urlDecode(parts[2]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqualBytes(expectedSig, providedSig)) {
    return { ok: false, reason: "bad_signature" };
  }
  return {
    ok: true,
    customerId: expected.customerId,
    orderId: expected.orderId,
    requirementId: expected.requirementId,
    exp,
  };
}
