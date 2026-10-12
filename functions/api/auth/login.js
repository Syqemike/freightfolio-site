/**
 * POST /api/auth/login — email + password login.
 * Body: { email, password }
 * Returns { ok: true } and sets session cookie on success.
 * Returns { ok: false, error } on failure (generic message to avoid enumeration).
 */
import { json } from "../../../lib/api-auth.js";
import { getCustomer } from "../../../lib/customer.js";
import { verifyPassword } from "../../../lib/password.js";
import { createSession, sessionCookie } from "../../../lib/session.js";
import { checkRateLimit, rateLimitId } from "../../../lib/session.js";

const GENERIC_FAIL = { ok: false, error: "invalid_credentials", message: "Invalid email or password." };

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");

  if (!email || !password) {
    return json(GENERIC_FAIL, 401);
  }

  // Rate limit login attempts: 10/hour per email, 30/hour per IP
  const ip = rateLimitId(request);
  const rlEmail = await checkRateLimit(env, "auth-login-email", email, 10);
  if (!rlEmail.ok) {
    return json({ ok: false, error: "rate_limited", message: "Too many attempts. Please wait a while and try again." }, 429);
  }
  const rlIp = await checkRateLimit(env, "auth-login-ip", ip, 30);
  if (!rlIp.ok) {
    return json({ ok: false, error: "rate_limited", message: "Too many attempts. Please wait a while and try again." }, 429);
  }

  const customer = await getCustomer(env, email);
  if (!customer || !customer.password_hash || !customer.password_salt) {
    return json(GENERIC_FAIL, 401);
  }

  const valid = await verifyPassword(password, customer.password_hash, customer.password_salt);
  if (!valid) {
    return json(GENERIC_FAIL, 401);
  }

  // Success: create session
  const session = await createSession(env, email);
  const cookie = sessionCookie(session.cookieValue, request);
  return json({ ok: true }, 200, { "set-cookie": cookie });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
