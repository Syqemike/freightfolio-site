/**
 * POST /api/auth/verify — consume a magic-link token and create a session.
 *
 * Body: { "token": "<64-hex magic token>" }
 *
 * Single-use tokens (15-min expiry). On success sets the HttpOnly
 * ff_session cookie and returns { ok:true, role }. Admin role is granted
 * only to freightfolio.ops@gmail.com; every other email gets "customer".
 *
 * Rate limit: 10/hour per IP. 429 with Retry-After on excess.
 */

import {
  verifyMagicToken,
  createSession,
  sessionCookieHeader,
  checkRateLimit,
  rateLimitId,
  ADMIN_EMAIL,
} from "../../../lib/session.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SESSION_SECRET || !env.ORDER_KV) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const ip = rateLimitId(request);
  const rl = await checkRateLimit(env, "auth-verify-ip", ip, 10);
  if (!rl.ok) {
    return json({ ok: false, error: "rate_limited" }, 429, {
      "retry-after": String(rl.retryAfterSeconds),
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const v = await verifyMagicToken(env, body.token);
  if (!v.ok) {
    const status = v.reason === "expired" ? 410 : 401;
    return json({ ok: false, error: "invalid_token", reason: v.reason }, status);
  }

  const role = v.email === ADMIN_EMAIL ? "admin" : "customer";
  let session;
  try {
    session = await createSession(env, v.email, role);
  } catch (e) {
    console.error("createSession failed", e);
    return json({ ok: false, error: "not_configured" }, 500);
  }

  return json(
    { ok: true, role },
    200,
    { "set-cookie": sessionCookieHeader(session.cookieValue) }
  );
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
