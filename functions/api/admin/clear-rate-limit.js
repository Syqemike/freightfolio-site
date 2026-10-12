/**
 * POST /api/admin/clear-rate-limit — one-time use: clears rate limit for an email.
 * Body: { email }. Delete after use.
 */
import { json } from "../../../lib/api-auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = (body.email || "").toLowerCase().trim();
  if (!email || !env.ORDER_KV) {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const hour = Math.floor(Date.now() / 3600000);
  // Clear current and previous hour to be safe
  for (const h of [hour, hour - 1]) {
    await env.ORDER_KV.delete(`rl:auth-request-email:${email}:${h}`);
  }

  return json({ ok: true });
}
