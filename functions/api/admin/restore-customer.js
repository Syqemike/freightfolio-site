/**
 * POST /api/admin/restore-customer — one-time use: recreates customer record
 * from Stripe subscription. Body: { email, stripe_customer_id }. Delete after use.
 */
import { json } from "../../../lib/api-auth.js";
import { newCustomerRecord, putCustomer, mapStripeCustomer } from "../../../lib/customer.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { email, stripe_customer_id } = body;
  if (!email || !stripe_customer_id) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const customer = newCustomerRecord(email.toLowerCase().trim());
  await putCustomer(env, customer);
  await mapStripeCustomer(env, stripe_customer_id, email.toLowerCase().trim());

  return json({ ok: true, email });
}
