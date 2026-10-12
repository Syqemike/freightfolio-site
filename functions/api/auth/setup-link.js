/**
 * POST /api/auth/setup-link — request a password-setup email.
 *
 * Body: { "email": "customer@example.com" }
 *
 * Audit 2026-10-12 (W-04): breaks the deadlock where a customer who never
 * receives the magic-link email can never set a password (set-password
 * requires a session, which requires the magic link). This endpoint issues a
 * single-use, 7-day password-setup token with NO prior session required.
 *
 * A link is sent ONLY when KV holds a paid order or an active subscription
 * for that email (server-verified Stripe events are the identity root).
 * The response is always the same generic message so the endpoint cannot be
 * used to enumerate customer accounts.
 *
 * Rate limits: 5/hour per email, 20/hour per IP. 429 with Retry-After on excess.
 */

import {
  normalizeEmail,
  validEmail,
  createPasswordSetupToken,
  checkRateLimit,
  rateLimitId,
  ADMIN_EMAIL,
} from "../../../lib/session.js";
import { getCustomer, activeSubscription } from "../../../lib/customer.js";
import { sendPasswordSetupLink } from "../../../lib/notify.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const GENERIC_OK = { ok: true, message: "If an account exists for that email, a password-setup link is on its way." };

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ORDER_KV || !env.UPLOAD_TOKEN_SECRET) {
    return json({ ok: false, error: "not_configured" }, 500);
  }
  if (!env.SESSION_SECRET || !env.RESEND_API_KEY) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) {
    // Same generic response: do not reveal validity.
    return json(GENERIC_OK);
  }

  const ip = rateLimitId(request);
  const rlEmail = await checkRateLimit(env, "auth-setuplink-email", email, 5);
  if (!rlEmail.ok) {
    return json(GENERIC_OK, 429, { "retry-after": String(rlEmail.retryAfterSeconds) });
  }
  const rlIp = await checkRateLimit(env, "auth-setuplink-ip", ip, 20);
  if (!rlIp.ok) {
    return json(GENERIC_OK, 429, { "retry-after": String(rlIp.retryAfterSeconds) });
  }

  const isAdmin = email === ADMIN_EMAIL;
  const customer = await getCustomer(env, email);
  const eligible =
    isAdmin ||
    (customer &&
      (customer.orders.length > 0 || activeSubscription(customer.subscription)));

  if (!eligible) {
    return json(GENERIC_OK); // no account — same response, no email sent
  }

  const token = await createPasswordSetupToken(env, email);
  const origin = (env.PUBLIC_ORIGIN || "https://freightfolio.net").replace(/\/+$/, "");
  const sent = await sendPasswordSetupLink(env, email, token, origin);
  if (!sent.ok) {
    console.error("password-setup email failed", sent.error);
    // Still return generic ok: the failure is logged for ops, and the
    // customer can retry (rate limit permitting).
  }
  return json(GENERIC_OK);
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
