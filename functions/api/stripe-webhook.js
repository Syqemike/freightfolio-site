/**
 * Stripe webhook receiver for Freightfolio.
 * Route: POST https://freightfolio.net/api/stripe-webhook
 *
 * Verifies the Stripe signature (HMAC-SHA256, 5-min tolerance) using the
 * STRIPE_WEBHOOK_SECRET environment variable, logs verified events to the
 * EVENT_LOG KV namespace, and returns 200. Notifications + pilot kickoff
 * are handled by the hourly stripe-watch job on the ops side.
 */

const TOLERANCE_SECONDS = 300;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const p of sigHeader.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${t}.${rawBody}`)
  );
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, v1);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  const ok = await verifySignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) {
    return new Response(JSON.stringify({ received: false, error: "bad signature" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ received: false, error: "bad json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Durable audit log of every verified event.
  // Storage failures return 5xx so Stripe retries delivery.
  // A 200 must never be sent for an event we failed to record.
  try {
    if (!env.EVENT_LOG) {
      throw new Error("EVENT_LOG KV binding missing");
    }
    const key = `evt_${event.id || Date.now()}`;
    await env.EVENT_LOG.put(
      key,
      JSON.stringify({
        id: event.id || null,
        type: event.type || null,
        created: event.created || null,
        livemode: event.livemode || false,
        received_at: new Date().toISOString(),
        summary: summarize(event),
      })
    );
  } catch (e) {
    console.error("KV write failed", e);
    return new Response(JSON.stringify({ received: false, error: "storage failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true, id: event.id || null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function summarize(event) {
  try {
    const o = event.data && event.data.object ? event.data.object : {};
    return {
      amount: o.amount_total ?? o.amount ?? null,
      currency: o.currency || null,
      customer_email:
        (o.customer_details && o.customer_details.email) || o.customer_email || null,
      payment_status: o.payment_status || o.status || null,
    };
  } catch {
    return {};
  }
}

// Explicitly reject non-POST to keep the surface tight.
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
