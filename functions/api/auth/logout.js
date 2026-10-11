/**
 * POST /api/auth/logout — destroy the current session and clear the cookie.
 */

import { getSession, destroySession, clearSessionCookieHeader } from "../../../lib/session.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)ff_session=([^;]+)/);
  if (m) {
    const sid = decodeURIComponent(m[1]).split(".")[0];
    await destroySession(env, sid);
  }
  // getSession is not needed here; best-effort delete by sid is enough.
  void getSession;
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookieHeader() });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
