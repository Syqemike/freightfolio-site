/**
 * POST /api/billing/portal — create a Stripe billing portal session for the
 * signed-in customer and return the URL. Customers manage payment methods,
 * invoices, and cancellation themselves via Stripe's hosted portal.
 *
 * Requires env.STRIPE_SECRET_KEY (restricted key with billing portal write).
 */
import { json, requireSession } from "../../../lib/api-auth.js";
import { getCustomer } from "../../../lib/customer.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ ok: false, error: "billing_not_configured" }, 503);
  }

  const customer = await getCustomer(env, session.email);
  const stripeCustomerIds = (customer && customer.stripe_customer_ids) || [];
  if (!stripeCustomerIds.length) {
    return json({ ok: false, error: "no_stripe_customer" }, 404);
  }

  const origin = new URL(request.url).origin;
  const body = new URLSearchParams({
    customer: stripeCustomerIds[0],
    return_url: origin + "/workspace",
  });

  const resp = await fetch(
    "https://api.stripe.com/v1/billing_portal/sessions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  const data = await resp.json();
  if (!resp.ok || !data.url) {
    console.error(
      "billing portal session failed",
      resp.status,
      data.error && data.error.message,
    );
    return json({ ok: false, error: "portal_failed" }, 502);
  }

  return json({ ok: true, url: data.url });
}
