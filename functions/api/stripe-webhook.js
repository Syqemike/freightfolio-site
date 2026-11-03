/* Freightfolio - Stripe webhook receiver.
 *
 * POST /api/stripe-webhook
 *   Receives Stripe events (checkout.session.completed, customer.subscription.*).
 *   Verifies the Stripe signature, then:
 *     - Creates a Customer record in the Notion Customers database
 *     - Reports the event to the Freightfolio ops dashboard
 *     - Emails Mike about the new subscriber
 *
 * Environment (set in the Cloudflare dashboard, never hardcoded):
 *   STRIPE_WEBHOOK_SECRET - webhook signing secret from Stripe
 *   NOTION_TOKEN          - Notion integration token
 *   DASHBOARD_INGEST_SECRET - dashboard ingest secret for /api/events
 *   RESEND_API_KEY        - Resend API key (already configured)
 */

var NOTION_CUSTOMERS_DB = "3911f483-d6c7-48e3-b181-893209281de5";
var DASHBOARD_URL = "https://dashboard.freightfolio.net";

var PRICE_TO_PACKAGE = {
  "price_1US9nTAN6U5YE12V7ga5qTAE": "Starter $149",
  "price_1US9nUAN6U5YE12VTFrL3TVX": "Professional $199",
  "price_1US9nWAN6U5YE12VOieZuMiJ": "Business Growth $299",
};

async function verifyStripeSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  var parts = {};
  signature.split(",").forEach(function (p) {
    var kv = p.split("=");
    if (kv.length === 2) parts[kv[0]] = kv[1];
  });
  var timestamp = parts["t"];
  var sig = parts["v1"];
  if (!timestamp || !sig) return false;

  /* Reject if timestamp is more than 5 minutes old (replay protection). */
  var now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  var signedPayload = timestamp + "." + rawBody;
  var key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  var sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  var expected = Array.from(new Uint8Array(sigBytes))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");

  /* Constant-time comparison. */
  if (expected.length !== sig.length) return false;
  var result = 0;
  for (var i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return result === 0;
}

async function createNotionCustomer(env, data) {
  var res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.NOTION_TOKEN,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_CUSTOMERS_DB },
      properties: {
        "Customer name": { title: [{ text: { content: data.name || data.email } }] },
        "Package": { select: { name: data.package } },
        "Status": { select: { name: "Active" } },
        "Start date": { date: { start: new Date().toISOString().slice(0, 10) } },
        "Stripe customer ID": { rich_text: [{ text: { content: data.stripeCustomerId } }] },
        "Notes": { rich_text: [{ text: { content: data.notes } }] },
      },
    }),
  });
  if (!res.ok) {
    var errText = await res.text();
    console.error("Notion customer creation failed:", res.status, errText.slice(0, 300));
    return null;
  }
  var page = await res.json();
  return page.id;
}

async function reportToDashboard(env, eventType, message, detail) {
  try {
    await fetch(DASHBOARD_URL + "/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ingest-secret": env.DASHBOARD_INGEST_SECRET,
      },
      body: JSON.stringify({
        agent: "stripe",
        type: eventType,
        message: message,
        detail: detail || "",
        at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("Dashboard report failed:", e.message);
  }
}

async function emailMike(env, subject, textBody) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Freightfolio <leads@freightfolio.net>",
        to: ["freightfolio.ops@gmail.com"],
        subject: subject,
        text: textBody,
      }),
    });
  } catch (e) {
    console.error("Email failed:", e.message);
  }
}

export async function onRequestPost(context) {
  var env = context.env || {};

  var rawBody = await context.request.text();
  var signature = context.request.headers.get("stripe-signature");

  var valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid signature." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    if (event.type === "checkout.session.completed") {
      var session = event.data.object;
      var customerId = session.customer;
      var customerEmail = (session.customer_details && session.customer_details.email) || session.customer_email || "";
      var customerName = (session.customer_details && session.customer_details.name) || "";

      /* Get the price from line items to determine the package. */
      var packageName = "Starter $149";
      var amountPaid = "";
      if (session.amount_total) {
        amountPaid = "$" + (session.amount_total / 100).toFixed(2);
      }
      /* Try to resolve package from the subscription's price if present. */
      var stripeSecretKey = env.STRIPE_SECRET_KEY;
      var priceId = null;
      if (stripeSecretKey && session.subscription) {
        try {
          var subRes = await fetch("https://api.stripe.com/v1/subscriptions/" + session.subscription, {
            headers: { "Authorization": "Bearer " + stripeSecretKey },
          });
          if (subRes.ok) {
            var sub = await subRes.json();
            if (sub.items && sub.items.data && sub.items.data.length > 0) {
              priceId = sub.items.data[0].price.id;
            }
          }
        } catch (e) {
          console.error("Subscription lookup failed:", e.message);
        }
      }
      if (priceId && PRICE_TO_PACKAGE[priceId]) {
        packageName = PRICE_TO_PACKAGE[priceId];
      } else if (session.metadata && session.metadata.package) {
        packageName = session.metadata.package;
      }

      var notes = "Subscribed via website checkout. " +
        (amountPaid ? "First payment: " + amountPaid + ". " : "") +
        "Checkout session: " + session.id;

      var notionPageId = null;
      if (env.NOTION_TOKEN) {
        notionPageId = await createNotionCustomer(env, {
          name: customerName,
          email: customerEmail,
          package: packageName,
          stripeCustomerId: customerId || "",
          notes: notes,
        });
      }

      var msg = "New subscriber: " + (customerName || customerEmail) + " (" + packageName + ")";
      await reportToDashboard(env, "new_subscriber", msg,
        "Email: " + customerEmail + ". Stripe customer: " + (customerId || "n/a") +
        ". Notion: " + (notionPageId ? "created" : "skipped") + ".");

      await emailMike(env,
        "New Freightfolio subscriber: " + (customerName || customerEmail),
        "Someone just subscribed to Freightfolio.\n\n" +
        "Name: " + (customerName || "(not provided)") + "\n" +
        "Email: " + customerEmail + "\n" +
        "Package: " + packageName + "\n" +
        (amountPaid ? "First payment: " + amountPaid + "\n" : "") +
        "Stripe customer ID: " + (customerId || "n/a") + "\n" +
        "Notion customer record: " + (notionPageId ? "created (" + notionPageId + ")" : "NOT created - check manually") + "\n\n" +
        "Next step: reach out within 24 hours to kick off their website build.");

    } else if (event.type === "customer.subscription.deleted") {
      var cancelled = event.data.object;
      var cCustomerId = cancelled.customer;
      await reportToDashboard(env, "subscription_cancelled",
        "Subscription cancelled",
        "Stripe customer: " + cCustomerId + ". Update their Notion record to Cancelled.");
      await emailMike(env, "Freightfolio subscription cancelled",
        "A subscription was cancelled.\n\nStripe customer ID: " + cCustomerId +
        "\n\nUpdate their Notion Customer record Status to Cancelled. " +
        "Per terms, their site stays up 1 month after the subscription ends.");

    } else if (event.type === "invoice.payment_failed") {
      var invoice = event.data.object;
      var fCustomerId = invoice.customer;
      await reportToDashboard(env, "payment_failed",
        "Subscription payment failed",
        "Stripe customer: " + fCustomerId + ". Amount: $" +
        ((invoice.amount_due || 0) / 100).toFixed(2) +
        ". Per terms: 4 weekly notices, then site goes down until paid.");
      await emailMike(env, "Freightfolio payment failed",
        "A subscription payment failed.\n\nStripe customer ID: " + fCustomerId +
        "\nAmount due: $" + ((invoice.amount_due || 0) / 100).toFixed(2) +
        "\n\nPer terms: send 4 weekly notices, then the site goes down until paid.");
    }
    /* Other event types: acknowledge without action. */

  } catch (e) {
    console.error("Webhook processing error:", e.message);
    /* Return 200 so Stripe does not retry a poisoned event endlessly.
       The error is logged and the dashboard/email alerts above cover ops. */
  }

  return new Response(JSON.stringify({ ok: true, received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return new Response(JSON.stringify({ ok: false, error: "Method not allowed." }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST" },
  });
}
