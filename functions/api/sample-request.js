/**
 * Sample-request lead capture for Freightfolio.
 * Route: POST https://freightfolio.net/api/sample-request
 *
 * Accepts JSON {name, email, company, message, website, source}, validates
 * server-side, applies naive per-IP rate limiting and spam heuristics, then
 * emails the lead to hello@freightfolio.net via the Resend API.
 *
 * The Resend API key comes ONLY from the RESEND_API_KEY environment variable
 * (Cloudflare Pages dashboard > Settings > Environment variables). It is never
 * hardcoded, never committed, and never written to any file. If unset, the
 * endpoint returns a clear error JSON and the site form shows a fallback.
 */

const FROM = "Freightfolio <hello@freightfolio.net>";
const TO = "hello@freightfolio.net";
const RESEND_URL = "https://api.resend.com/emails";

// Naive per-IP rate limit: 5 submissions per 10 minutes (in-memory; resets on cold start).
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const rateStore = new Map(); // ip -> array of timestamps

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (rateStore.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    rateStore.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateStore.set(ip, hits);
  // Opportunistic cleanup so the map cannot grow unboundedly.
  if (rateStore.size > 5000) {
    for (const [k, v] of rateStore) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) rateStore.delete(k);
    }
  }
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SPAM_KEYWORDS = ["seo services", "crypto", "forex", "bitcoin", "viagra", "cialis", "loan offer"];

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function validate(body) {
  const name = clean(body.name, 100);
  const email = clean(body.email, 254);
  const company = clean(body.company, 120);
  const message = clean(body.message, 2000);
  const source = clean(body.source, 60);

  if (!name) return { ok: false, field: "name", message: "Please enter your name." };
  if (!email || !EMAIL_RE.test(email))
    return { ok: false, field: "email", message: "Please enter a valid business email." };
  if (!message || message.length < 10)
    return {
      ok: false,
      field: "message",
      message: "Tell us a few words about your paperwork (at least 10 characters).",
    };

  // Naive spam heuristics: excessive links or classic spam keywords.
  const urls = message.match(/https?:\/\/|www\./gi) || [];
  if (urls.length > 2) return { ok: false, field: "message", message: "Please remove links from your message." };
  const lower = `${name} ${company} ${message}`.toLowerCase();
  if (SPAM_KEYWORDS.some((k) => lower.includes(k)))
    return { ok: false, field: "message", message: "Your message looks like spam. Please write to hello@freightfolio.net directly." };

  return { ok: true, name, email, company, message, source };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    // Graceful failure: the form shows a "please email us directly" fallback.
    return json({ ok: false, error: "service_not_configured" }, 500);
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (isRateLimited(ip)) {
    return json({ ok: false, error: "rate_limited", message: "Too many requests. Please try again in a few minutes." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  // Honeypot: bots fill the hidden "website" field; real forms never do.
  if (body && typeof body.website === "string" && body.website.trim() !== "") {
    return json({ ok: true }); // silent accept — don't tip off the bot
  }

  const v = validate(body || {});
  if (!v.ok) {
    return json({ ok: false, error: "validation", field: v.field, message: v.message }, 400);
  }

  const subject = `[SAMPLE REQUEST] ${v.company || v.name}: sample report request`;
  const textLines = [
    "New sample report request from freightfolio.net",
    "",
    `Name: ${v.name}`,
    `Email: ${v.email}`,
    `Company: ${v.company || "(not provided)"}`,
    `Source page: ${v.source || "(unknown)"}`,
    `IP: ${ip}`,
    `User-Agent: ${clean(request.headers.get("user-agent"), 200) || "(unknown)"}`,
    "",
    "Message:",
    v.message,
  ];

  let resendRes;
  try {
    resendRes = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: v.email,
        subject,
        text: textLines.join("\n"),
      }),
    });
  } catch (e) {
    console.error("Resend request failed", e);
    return json({ ok: false, error: "send_failed" }, 502);
  }

  if (!resendRes.ok) {
    console.error("Resend API error", resendRes.status, await resendRes.text().catch(() => ""));
    return json({ ok: false, error: "send_failed" }, 502);
  }

  return json({ ok: true });
}

// Explicitly reject non-POST to keep the surface tight.
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
