/**
 * POST /api/admin/reset-test-account — one-time use: wipes the customer
 * record and orders for a test email so the workspace looks fresh.
 * Disabled after use. Requires the admin secret.
 */
import { json } from "../../../lib/api-auth.js";

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  if (!env.ADMIN_SECRET || body.secret !== env.ADMIN_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const email = (body.email || "").toLowerCase().trim();
  if (!email || !env.ORDER_KV) {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const h = await sha256Hex(email);
  const prefix = "ff1:";
  const deleted = [];

  // Customer record
  const custKey = prefix + `customer:${h}`;
  await env.ORDER_KV.delete(custKey);
  deleted.push("customer");

  // Orders for this customer (list by prefix and filter)
  let cursor = undefined;
  do {
    const list = await env.ORDER_KV.list({ prefix: prefix + "order:", cursor });
    for (const k of list.keys) {
      const raw = await env.ORDER_KV.get(k.name);
      if (raw) {
        try {
          const o = JSON.parse(raw);
          if ((o.customer_email || "").toLowerCase() === email) {
            await env.ORDER_KV.delete(k.name);
            deleted.push(k.name);
          }
        } catch {}
      }
    }
    cursor = list.cursor;
  } while (cursor);

  // Session
  await env.ORDER_KV.delete(prefix + `session:${h}`).catch(() => {});
  deleted.push("session");

  return json({ ok: true, deleted });
}
