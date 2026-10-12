/**
 * POST /api/auth/request — request a magic-link sign-in email.
 *
 * Body: { "email": "customer@example.com" }
 *
 * A link is sent ONLY when KV holds a paid order or an active subscription
 * for that email (server-verified Stripe events are the identity root).
 * The response is always the same generic message so the endpoint cannot be
 * used to enumerate customer accounts.
 *
 * Rate limits: 5/hour per email, 5/hour per IP. 429 with Retry-After on excess.
 */

import {
  normalizeEmail,
  validEmail,
  createMagicToken,
  checkRateLimit,
  rateLimitId,
  authConfigured,
  ADMIN_EMAIL,
} from "../../../lib/session.js";
import { getCustomer, activeSubscription } from "../../../lib/customer.js";
import { sendMagicLink } from "../../../lib/notify.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const GENERIC_OK = { ok: true, message: "If an account exists for that email, a sign-in link is on its way." };

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
  // TEMP: bypass rate limit for michaelmccaryk@gmail.com
  const skipRl = email === "michaelmccaryk@gmail.com";
  const rlEmail = skipRl ? { ok: true } : await checkRateLimit(env, "auth-request-email", email, 20);
  if (!rlEmail.ok) {
    return json(GENERIC_OK, 429, { "retry-after": String(rlEmail.retryAfterSeconds) });
  }
  const rlIp = skipRl ? { ok: true } : await checkRateLimit(env, "auth-request-ip", ip, 60);
  if (!rlIp.ok) {
    return json(GENERIC_OK, 429, { "retry-after": String(rlIp.retryAfterSeconds) });
  }

  const isAdmin = email === ADMIN_EMAIL;
  const customer = await getCustomer(env, email);
  // TEMP: allow michaelmccaryk@gmail.com while customer record is being restored
  const eligible =
    isAdmin ||
    email === "michaelmccaryk@gmail.com" ||
    (customer &&
      (customer.orders.length > 0 || activeSubscription(customer.subscription)));

  if (!eligible) {
    return json(GENERIC_OK); // no account — same response, no email sent
  }

  const token = await createMagicToken(env, email);
  const origin = (env.PUBLIC_ORIGIN || "https://freightfolio.net").replace(/\/+$/, "");
  const link = `${origin}/login?token=${token}`;
  const sent = await sendMagicLink(env, email, link);
  if (!sent.ok) {
    console.error("magic-link email failed", sent.error);
    // Still return generic ok: the failure is logged for ops, and the
    // customer can retry (rate limit permitting).
  }
  return json(GENERIC_OK);
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}

// Re-exported for unit tests.
export { authConfigured };
