/* Freightfolio - free website preview lead capture.
 *
 * POST /api/lead
 *   Accepts JSON from the request.html form. Validates, then emails the lead
 *   via Resend and stores a copy in KV (when bound).
 *
 * Environment (set in the Cloudflare dashboard, never hardcoded):
 *   RESEND_API_KEY  - Resend API key (secret)
 *   LEAD_TO_EMAIL   - where lead emails go (defaults to hello@freightfolio.net)
 *   LEADS_KV        - KV namespace binding (optional)
 */

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
var MAX_LEN = 2000;

function bad(message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function clip(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_LEN);
}

export async function onRequestPost(context) {
  var env = context.env || {};

  try {
    var body;
    try {
      body = await context.request.json();
    } catch (e) {
      return bad("Please submit the form as JSON.");
    }
    if (!body || typeof body !== "object") {
      return bad("Please submit the form as JSON.");
    }

    /* Honeypot: bots fill this, humans leave it empty. Swallow silently. */
    if (body.website_url && String(body.website_url).trim() !== "") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    var businessName = clip(body.business_name);
    var yourName = clip(body.your_name);
    var email = clip(body.email);
    var phone = clip(body.phone);
    var currentWebsite = clip(body.current_website);
    var businessType = clip(body.business_type);
    var plan = clip(body.plan);
    var comments = clip(body.comments);
    var features = Array.isArray(body.features)
      ? body.features.filter(function (f) { return typeof f === "string"; }).map(function (f) { return f.trim().slice(0, 120); })
      : [];

    if (!businessName) return bad("Business name is required.");
    if (!yourName) return bad("Your name is required.");
    if (!email || !EMAIL_RE.test(email)) return bad("A valid email address is required.");
    if (!businessType) return bad("Business type is required.");
    if (phone && !/^[+()\-.\s\d]{7,}$/.test(phone)) return bad("That phone number does not look right.");

    var lines = [
      "New website preview request",
      "",
      "Business: " + businessName,
      "Name: " + yourName,
      "Email: " + email,
      "Phone: " + (phone || "(not provided)"),
      "Current website: " + (currentWebsite || "(none)"),
      "Business type: " + businessType,
      "Plan of interest: " + (plan || "(not specified)"),
      "Desired features: " + (features.length ? features.join(", ") : "(none selected)"),
      "",
      "Comments:",
      comments || "(none)",
      "",
      "Received: " + new Date().toISOString(),
    ];
    var textBody = lines.join("\n");

    /* Store in KV first (best effort), so nothing is lost if email fails. */
    var record = {
      business_name: businessName,
      your_name: yourName,
      email: email,
      phone: phone,
      current_website: currentWebsite,
      business_type: businessType,
      plan: plan,
      features: features,
      comments: comments,
      received_at: new Date().toISOString(),
    };
    if (env.LEADS_KV && typeof env.LEADS_KV.put === "function") {
      var key = "lead:" + Date.now() + ":" + Math.random().toString(36).slice(2, 10);
      await env.LEADS_KV.put(key, JSON.stringify(record));
    }

    /* Email the lead via Resend. */
    var resendKey = env.RESEND_API_KEY;
    if (!resendKey) {
      /* Lead is safely in KV; email just needs the key configured. */
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    var to = env.LEAD_TO_EMAIL || "hello@freightfolio.net";
    var res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Freightfolio <leads@freightfolio.net>",
        to: [to],
        reply_to: email,
        subject: "New website preview request: " + businessName,
        text: textBody,
      }),
    });

    if (!res.ok) {
      /* Do not leak provider internals to the client. */
      return new Response(JSON.stringify({ ok: false, error: "Something went wrong sending your request. Please try again later." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Something went wrong sending your request. Please try again later." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/* Reject non-POST methods explicitly. */
export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return new Response(JSON.stringify({ ok: false, error: "Method not allowed." }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST" },
  });
}
