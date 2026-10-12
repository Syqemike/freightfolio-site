/**
 * lib/session.js — passwordless email magic-link auth + server sessions for the
 * Freightfolio customer workspace.
 *
 * Identity root: server-verified Stripe events (webhook). A magic link is only
 * issued when KV holds a paid order or an active subscription for the email.
 * Access is NEVER granted from a URL parameter, a client-side payment claim,
 * or an unverified email address.
 *
 * Flow:
 *   POST /api/auth/request {email} -> if customer exists, store single-use
 *     magic token (15-min TTL) and email the link. Always returns a generic
 *     "check your email" response (no account enumeration).
 *   POST /api/auth/verify {token}  -> consumes the token, creates a session:
 *     KV session:{sid} (7-day TTL) + HMAC-signed HttpOnly cookie ff_session.
 *   Session cookie value: <64-hex sid>.<64-hex HMAC(SESSION_SECRET, sid)>
 *
 * Admin: the same magic-link flow, but only freightfolio.ops@gmail.com may
 * receive a session with role "admin". All other emails are rejected at
 * request time.
 *
 * Also: KV sliding-window rate limiter and the INTAKE_INTERNAL_KEY guard used
 * by internal endpoints (status sync from the processing bridge, test orders).
 *
 * Works in Cloudflare Workers/Pages (Web Crypto) and Node 18+.
 */

const te = new TextEncoder();

export const ADMIN_EMAIL = "freightfolio.ops@gmail.com";
export const MAGIC_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const COOKIE_NAME = "ff_session";

export function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export async function emailHash(email) {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(normalizeEmail(email)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * KV sliding-window rate limiter (approximate; KV writes are not atomic).
 * Returns {ok:true} or {ok:false, retryAfterSeconds}.
 */
export async function checkRateLimit(env, scope, identifier, limitPerHour) {
  const kv = env.ORDER_KV;
  if (!kv) return { ok: true }; // fail open only when KV itself is missing (endpoints 503 anyway)
  const hour = Math.floor(Date.now() / 3600000);
  const k = `rl:${scope}:${identifier}:${hour}`;
  const raw = await kv.get(k);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= limitPerHour) {
    const retryAfter = 3600 - (Math.floor(Date.now() / 1000) % 3600);
    return { ok: false, retryAfterSeconds: retryAfter };
  }
  await kv.put(k, String(count + 1), { expirationTtl: 7200 });
  return { ok: true };
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function rateLimitId(request) {
  return (clientIp(request) || "unknown").slice(0, 64);
}

/**
 * Create a single-use magic-link token for an email. Caller must have already
 * verified the email belongs to a paying customer (or the admin).
 */
export async function createMagicToken(env, email) {
  const token = randomHex(32);
  const now = Date.now();
  await env.ORDER_KV.put(
    `magic:${token}`,
    JSON.stringify({ email: normalizeEmail(email), created_at: now, exp: now + MAGIC_TOKEN_TTL_SECONDS * 1000, used: false }),
    { expirationTtl: MAGIC_TOKEN_TTL_SECONDS + 60 }
  );
  return token;
}

/**
 * Verify + consume a magic token. Single-use: a second attempt fails.
 * Returns {ok:true, email} or {ok:false, reason}.
 */
export async function verifyMagicToken(env, token) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  const raw = await env.ORDER_KV.get(`magic:${token}`);
  if (!raw) return { ok: false, reason: "invalid" };
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (rec.used) return { ok: false, reason: "already_used" };
  if (Date.now() > rec.exp) return { ok: false, reason: "expired" };
  rec.used = true;
  await env.ORDER_KV.put(`magic:${token}`, JSON.stringify(rec), { expirationTtl: 300 });
  return { ok: true, email: rec.email };
}

/**
 * Password-setup tokens (audit 2026-10-12, W-04). Breaks the deadlock where
 * a customer who never receives the magic-link email can never set a
 * password (set-password requires a session, which requires the magic link).
 * A setup token is emailed on request (rate-limited, eligibility-gated) and
 * lets the customer set a password with no prior session. Single-use,
 * 7-day TTL.
 */
export const PW_SETUP_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function createPasswordSetupToken(env, email) {
  const token = randomHex(32);
  const now = Date.now();
  await env.ORDER_KV.put(
    `pwsetup:${token}`,
    JSON.stringify({ email: normalizeEmail(email), created_at: now, exp: now + PW_SETUP_TOKEN_TTL_SECONDS * 1000, used: false }),
    { expirationTtl: PW_SETUP_TOKEN_TTL_SECONDS + 60 }
  );
  return token;
}

/**
 * Verify + consume a password-setup token. Single-use: a second attempt fails.
 * Returns {ok:true, email} or {ok:false, reason}.
 */
export async function consumePasswordSetupToken(env, token) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  const raw = await env.ORDER_KV.get(`pwsetup:${token}`);
  if (!raw) return { ok: false, reason: "invalid" };
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (rec.used) return { ok: false, reason: "already_used" };
  if (Date.now() > rec.exp) return { ok: false, reason: "expired" };
  rec.used = true;
  await env.ORDER_KV.put(`pwsetup:${token}`, JSON.stringify(rec), { expirationTtl: 300 });
  return { ok: true, email: rec.email };
}

/**
 * Create a session for an email. Returns {sessionId, cookieValue, expiresAt}.
 */
export async function createSession(env, email, role = "customer") {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const sid = randomHex(32);
  const sig = await hmacHex(secret, sid);
  const now = Date.now();
  const rec = {
    sid,
    email: normalizeEmail(email),
    role,
    created_at: now,
    expires_at: now + SESSION_TTL_SECONDS * 1000,
  };
  await env.ORDER_KV.put(`session:${sid}`, JSON.stringify(rec), {
    expirationTtl: SESSION_TTL_SECONDS + 60,
  });
  return { sessionId: sid, cookieValue: `${sid}.${sig}`, expiresAt: rec.expires_at };
}

export function sessionCookieHeader(cookieValue, maxAge = SESSION_TTL_SECONDS) {
  return `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// Alias for password-login code that expects this name
export function sessionCookie(sessionId, request) {
  return sessionCookieHeader(sessionId);
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * Resolve the session from the request cookie. Verifies the HMAC signature
 * (constant-time), the KV record, and expiry. Returns the session record or null.
 */
export async function getSession(request, env) {
  const secret = env.SESSION_SECRET;
  if (!secret || !env.ORDER_KV) return null;
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)ff_session=([^;]+)/);
  if (!m) return null;
  const parts = decodeURIComponent(m[1]).split(".");
  if (parts.length !== 2) return null;
  const [sid, sig] = parts;
  if (!/^[0-9a-f]{64}$/.test(sid) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = await hmacHex(secret, sid);
  if (!timingSafeEqualStr(expected, sig)) return null;
  const raw = await env.ORDER_KV.get(`session:${sid}`);
  if (!raw) return null;
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!rec.email || Date.now() > rec.expires_at) {
    await env.ORDER_KV.delete(`session:${sid}`).catch(() => {});
    return null;
  }
  if (rec.role === "admin" && rec.email !== ADMIN_EMAIL) return null; // never honor a forged admin role
  return rec;
}

// Alias for password-login code that expects this name
export async function getSessionFromRequest(request, env) {
  return getSession(request, env);
}

export async function destroySession(env, sid) {
  if (sid && env.ORDER_KV) await env.ORDER_KV.delete(`session:${sid}`).catch(() => {});
}

/**
 * Guard for internal endpoints (bridge status sync, test orders).
 * Expects the key in the JSON body as {internal_key} or the
 * x-internal-key header. Constant-time comparison.
 */
export function checkInternalKey(bodyKey, headerKey, env) {
  const expected = env.INTAKE_INTERNAL_KEY || "";
  if (!expected) return false;
  const provided = typeof bodyKey === "string" && bodyKey ? bodyKey : typeof headerKey === "string" ? headerKey : "";
  return timingSafeEqualStr(provided, expected);
}

/** True when every session-dependent feature can run. */
export function authConfigured(env) {
  return Boolean(env.SESSION_SECRET && env.ORDER_KV && env.UPLOAD_TOKEN_SECRET);
}
