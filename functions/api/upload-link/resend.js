/**
 * POST /api/upload-link/resend — "resend my upload link" (no sign-in).
 *
 * Body: { "email": "customer@example.com" }
 *
 * Looks up the customer's latest order via the email index written at
 * payment time, mints a fresh 7-day upload token, and emails the link.
 * Always returns {ok:true} so the endpoint can't be used to probe which
 * addresses have orders. Rate-limited to 3 requests/hour per address.
 */
import { getOrder, putOrder, sha256HexAsync } from "../../../lib/order-store.js";
import { createUploadToken, UPLOAD_TOKEN_TTL_SECONDS } from "../../../lib/tokens.js";
import { sendUploadLinkResend, uploadLinkFor } from "../../../lib/notify.js";

const RESEND_LIMIT = 3;
const RESEND_WINDOW_SECONDS = 3600;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.UPLOAD_TOKEN_SECRET || !env.ORDER_KV || !env.RESEND_API_KEY) {
    // Still return ok:true — never leak configuration state.
    return json({ ok: true });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: true });
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: true });
  }

  const kv = env.ORDER_KV;
  const emailHash = await sha256HexAsync(email);

  // Rate limit (per address, sliding-ish window via TTL).
  const rlKey = `resend_rl:${emailHash}`;
  let hits = 0;
  try {
    hits = Number(await kv.get(rlKey)) || 0;
  } catch {
    return json({ ok: true });
  }
  if (hits >= RESEND_LIMIT) {
    return json({ ok: true });
  }

  // Resolve the order via the email index (test namespace first, then prod).
  let order = null;
  let orderTestNs = false;
  for (const test of [true, false]) {
    const prefix = test ? "test:" : "";
    let orderId = null;
    try {
      orderId = await kv.get(`${prefix}email:${emailHash}`);
    } catch {
      continue;
    }
    if (!orderId) continue;
    try {
      order = await getOrder(env, orderId, { test });
    } catch {
      order = null;
    }
    if (order) {
      orderTestNs = test;
      break;
    }
  }
  if (!order) {
    return json({ ok: true });
  }

  // Mint a fresh token and persist it on the order.
  let token;
  try {
    token = await createUploadToken(order.order_id, env.UPLOAD_TOKEN_SECRET, UPLOAD_TOKEN_TTL_SECONDS);
  } catch {
    return json({ ok: true });
  }
  order.upload_token = token;
  try {
    await putOrder(env, order, { test: orderTestNs });
  } catch {
    return json({ ok: true });
  }

  const origin = new URL(request.url).origin;
  const link = uploadLinkFor(order, origin);
  const sent = await sendUploadLinkResend(env, email, link);

  if (sent.ok) {
    try {
      await kv.put(rlKey, String(hits + 1), { expirationTtl: RESEND_WINDOW_SECONDS });
    } catch {
      // Non-fatal: the email already went out.
    }
  }
  return json({ ok: true });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
