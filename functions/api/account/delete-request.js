/**
 * POST /api/account/delete-request — customer asks for their data to be deleted.
 *
 * There is no automated deletion pipeline, so this records the request and
 * emails ops to handle it manually. Honest by design.
 */

import { json, requireSession } from "../../../lib/api-auth.js";

function opsInbox(env) {
  return env.OPS_NOTIFY_EMAIL || "hello@freightfolio.net";
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const detail = String(body.detail || "").slice(0, 1000);

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return json({ ok: false, error: "not_configured" }, 500);

  const text = [
    "Customer requested deletion of their data.",
    "",
    `Email: ${session.email}`,
    `Requested at: ${new Date().toISOString()}`,
    detail ? `Customer note: ${detail}` : "No note provided.",
    "",
    "Action: manually remove the customer's files from the private B2 bucket, delete their KV records (customer + orders), and confirm by reply.",
  ].join("\n");

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Cloudflare bot protection 403s the default fetch User-Agent.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: JSON.stringify({
        from: "Freightfolio <hello@freightfolio.net>",
        to: [opsInbox(env)],
        subject: `[PRIVACY] Deletion request from ${session.email}`,
        text,
        reply_to: session.email,
      }),
    });
  } catch (e) {
    console.error("deletion-request email failed", e);
    return json({ ok: false, error: "send_failed" }, 503);
  }
  if (!res.ok) {
    console.error("deletion-request email failed", res.status);
    return json({ ok: false, error: "send_failed" }, 503);
  }
  return json({ ok: true });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
