/**
 * lib/api-auth.js — shared session guards for workspace/admin API endpoints.
 */
import { getSession, ADMIN_EMAIL } from "./session.js";

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Require any signed-in session. Returns {session} or {response} (401). */
export async function requireSession(request, env) {
  if (!env.SESSION_SECRET || !env.ORDER_KV) {
    return { response: json({ ok: false, error: "not_configured" }, 503) };
  }
  const session = await getSession(request, env);
  if (!session) {
    return { response: json({ ok: false, error: "unauthorized" }, 401) };
  }
  return { session };
}

/** Require an admin session (freightfolio.ops@gmail.com only). 401/403 otherwise. */
export async function requireAdmin(request, env) {
  const r = await requireSession(request, env);
  if (r.response) return r;
  if (r.session.role !== "admin" || r.session.email !== ADMIN_EMAIL) {
    return { response: json({ ok: false, error: "forbidden" }, 403) };
  }
  return r;
}
