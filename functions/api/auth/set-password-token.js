/**
 * POST /api/auth/set-password-token — set a password via a setup token.
 *
 * Body: { token, password }
 *
 * Audit 2026-10-12 (W-04): the escape hatch for customers who never receive
 * the magic-link email. The single-use setup token (issued by
 * POST /api/auth/setup-link, 7-day TTL) authorizes setting the password with
 * NO prior session. On success the password is stored (PBKDF2) and a fresh
 * session cookie is issued, so the customer is signed in immediately.
 *
 * Security notes:
 * - Token is single-use and bound to one email (consumed atomically).
 * - If the customer already has a password, the token is rejected: password
 *   changes for existing passwords still require a session (set-password).
 * - The token alone proves nothing beyond "holder of the emailed link";
 *   issuance was eligibility-gated at setup-link time.
 */
import { json } from "../../../lib/api-auth.js";
import { getCustomer, putCustomer } from "../../../lib/customer.js";
import { hashPassword } from "../../../lib/password.js";
import {
  consumePasswordSetupToken,
  createSession,
  sessionCookie,
} from "../../../lib/session.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ORDER_KV || !env.SESSION_SECRET) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  const password = String(body.password || "");

  if (password.length < 8) {
    return json({ ok: false, error: "weak_password", message: "Password must be at least 8 characters." }, 400);
  }
  if (password.length > 128) {
    return json({ ok: false, error: "password_too_long" }, 400);
  }

  const consumed = await consumePasswordSetupToken(env, token);
  if (!consumed.ok) {
    return json({ ok: false, error: "invalid_token", message: "This setup link is invalid, expired, or already used." }, 400);
  }

  const customer = await getCustomer(env, consumed.email);
  if (!customer) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  if (customer.password_hash) {
    // A password already exists: changing it requires a session.
    return json({ ok: false, error: "already_set", message: "A password is already set. Sign in and change it in Account settings." }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  customer.password_hash = hash;
  customer.password_salt = salt;
  await putCustomer(env, customer);

  // Sign the customer in immediately.
  const session = await createSession(env, consumed.email);
  const cookie = sessionCookie(session.cookieValue, request);
  return json({ ok: true }, 200, { "set-cookie": cookie });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
