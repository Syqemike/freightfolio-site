/**
 * POST /api/auth/set-password — set or change password.
 * Requires an active session (user must be logged in via magic link first).
 * Body: { password, current_password? }
 * - If customer already has a password, current_password is required.
 * - If no password set yet, just requires active session.
 */
import { json } from "../../../lib/api-auth.js";
import { getCustomer, putCustomer } from "../../../lib/customer.js";
import { hashPassword, verifyPassword } from "../../../lib/password.js";
import { getSessionFromRequest } from "../../../lib/session.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  // Must have active session
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");
  const currentPassword = String(body.current_password || "");

  if (password.length < 8) {
    return json({ ok: false, error: "weak_password", message: "Password must be at least 8 characters." }, 400);
  }
  if (password.length > 128) {
    return json({ ok: false, error: "password_too_long" }, 400);
  }

  const customer = await getCustomer(env, session.email);
  if (!customer) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  // If password already set, require current password
  if (customer.password_hash) {
    if (!currentPassword) {
      return json({ ok: false, error: "current_required", message: "Enter your current password." }, 400);
    }
    const valid = await verifyPassword(currentPassword, customer.password_hash, customer.password_salt);
    if (!valid) {
      return json({ ok: false, error: "invalid_current", message: "Current password is incorrect." }, 401);
    }
  }

  const { hash, salt } = await hashPassword(password);
  customer.password_hash = hash;
  customer.password_salt = salt;
  await putCustomer(env, customer);

  return json({ ok: true });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
