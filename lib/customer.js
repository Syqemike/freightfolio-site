/**
 * lib/customer.js — customer records linking Stripe-verified payments to
 * workspace access.
 *
 * Identity root is always a server-verified Stripe event (webhook). The
 * customer record is the union of a customer's pilot orders and subscription.
 *
 * KV layout:
 *   customer:{sha256(email)}   -> customer record (see below)
 *   stripe_cus:{cus_id}        -> sha256(email) (resolves subscription/invoice
 *                                 events, which carry a customer id but no email)
 *
 * Customer record:
 * {
 *   email, created_at, updated_at,
 *   orders: [order_id, ...],          // pilot orders + subscription period orders
 *   stripe_customer_ids: ["cus_..."],
 *   subscription: null | {
 *     stripe_sub_id, price_id, plan: "starter"|"business"|"premium",
 *     status: "active"|"trialing"|"past_due"|"canceled"|"incomplete"|"incomplete_expired",
 *     current_period_start: ISO, current_period_end: ISO,
 *     allowance: 100|400|1000, cancel_at_period_end: bool, updated_at: ISO
 *   }
 * }
 *
 * Subscription period orders: product "subscription", one per billing period,
 * created lazily by ensurePeriodOrder(). Files/usage for the current period
 * live on that order record, so the existing upload machinery works unchanged.
 */

import { emailHash, normalizeEmail } from "./session.js";
import {
  getOrder,
  putOrder,
  newOrderId,
  sha256HexAsync,
  DOC_ALLOWANCE_MINI_PILOT,
} from "./order-store.js";
import { createUploadToken, UPLOAD_TOKEN_TTL_SECONDS } from "./tokens.js";

export const PLANS = {
  starter: { name: "Starter", amount_cents: 3900, allowance: 100 },
  business: { name: "Business", amount_cents: 14900, allowance: 400 },
  premium: { name: "Premium", amount_cents: 36900, allowance: 1000 },
};

/** Map a Stripe amount (cents) to a plan key. Mirrors the stripe-watch convention. */
export function planForAmountCents(amountCents) {
  for (const [plan, cfg] of Object.entries(PLANS)) {
    if (cfg.amount_cents === amountCents) return plan;
  }
  return null;
}

export function activeSubscription(sub) {
  if (!sub) return false;
  return sub.status === "active" || sub.status === "trialing";
}

function kvKey(env, name) {
  void env;
  return name;
}

export async function getCustomer(env, email) {
  if (!env.ORDER_KV) return null;
  const h = await emailHash(email);
  const raw = await env.ORDER_KV.get(kvKey(env, `customer:${h}`));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putCustomer(env, customer) {
  const h = await emailHash(customer.email);
  customer.updated_at = new Date().toISOString();
  await env.ORDER_KV.put(kvKey(env, `customer:${h}`), JSON.stringify(customer));
}

export function newCustomerRecord(email) {
  const now = new Date().toISOString();
  return {
    email: normalizeEmail(email),
    created_at: now,
    updated_at: now,
    orders: [],
    stripe_customer_ids: [],
    subscription: null,
    test: false, // true for synthetic customers (Stripe test mode / internal test orders)
  };
}

/** Get an order regardless of live/test namespace (tries live first). */
export async function getOrderAny(env, orderId) {
  if (!orderId) return null;
  let o = await getOrder(env, orderId, { test: false });
  if (!o) o = await getOrder(env, orderId, { test: true });
  return o;
}

/**
 * Get-or-create the customer record, then attach an order id.
 * Idempotent on order id (never duplicates the entry).
 */
export async function attachOrderToCustomer(env, email, orderId, opts = {}) {
  let customer = await getCustomer(env, email);
  if (!customer) customer = newCustomerRecord(email);
  if (!customer.orders.includes(orderId)) customer.orders.push(orderId);
  if (opts.test === true) customer.test = true;
  await putCustomer(env, customer);
  return customer;
}

/** Remember stripe_customer_id -> email hash for later event resolution. */
export async function mapStripeCustomer(env, stripeCustomerId, email) {
  if (!stripeCustomerId || !env.ORDER_KV) return;
  const h = await emailHash(email);
  await env.ORDER_KV.put(kvKey(env, `stripe_cus:${stripeCustomerId}`), h, {
    expirationTtl: 400 * 24 * 60 * 60,
  });
  const customer = await getCustomer(env, email);
  if (customer && !customer.stripe_customer_ids.includes(stripeCustomerId)) {
    customer.stripe_customer_ids.push(stripeCustomerId);
    await putCustomer(env, customer);
  }
}

/** Resolve an email from a Stripe customer id (set during checkout). */
export async function emailForStripeCustomer(env, stripeCustomerId) {
  if (!stripeCustomerId || !env.ORDER_KV) return null;
  const h = await env.ORDER_KV.get(kvKey(env, `stripe_cus:${stripeCustomerId}`));
  return h || null; // returns the email hash; callers match against customer records
}

/** Full customer record for a Stripe customer id, or null when unknown. */
export async function customerForStripeCustomer(env, stripeCustomerId) {
  const h = await emailForStripeCustomer(env, stripeCustomerId);
  if (!h || !env.ORDER_KV) return null;
  const raw = await env.ORDER_KV.get(kvKey(env, `customer:${h}`));
  return raw ? JSON.parse(raw) : null;
}

/**
 * Upsert subscription state from a verified Stripe subscription object.
 * `email` may be null when the event carries no email — callers should resolve
 * via the stripe_cus mapping first. `test` marks synthetic (Stripe test mode)
 * customers so their period orders stay in the test namespace.
 */
export async function upsertSubscription(env, { email, subscription, test }) {
  if (!email) return { ok: false, error: "no_email" };
  const sub = subscription || {};
  const price = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price) || {};
  const amount = price.unit_amount ?? null;
  const plan = planForAmountCents(amount) || "starter";
  const item = (sub.items && sub.items.data && sub.items.data[0]) || {};
  const periodStart = item.current_period_start || sub.current_period_start || null;
  const periodEnd = item.current_period_end || sub.current_period_end || null;

  let customer = await getCustomer(env, email);
  if (!customer) customer = newCustomerRecord(email);
  customer.subscription = {
    stripe_sub_id: sub.id || null,
    price_id: price.id || null,
    plan,
    status: sub.status || "unknown",
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    allowance: PLANS[plan].allowance,
    cancel_at_period_end: sub.cancel_at_period_end === true,
    updated_at: new Date().toISOString(),
  };
  if (sub.customer && !customer.stripe_customer_ids.includes(sub.customer)) {
    customer.stripe_customer_ids.push(sub.customer);
  }
  if (test === true) customer.test = true;
  await putCustomer(env, customer);
  if (sub.customer) await mapStripeCustomer(env, sub.customer, email);
  return { ok: true, customer };
}

/**
 * Ensure a period order exists for the customer's ACTIVE subscription for the
 * current billing period. Creates one lazily (product "subscription").
 * Returns the order record, or null when there is no active subscription.
 */
export async function ensurePeriodOrder(env, email) {
  const customer = await getCustomer(env, email);
  if (!customer || !activeSubscription(customer.subscription)) return null;
  const sub = customer.subscription;
  const periodKey = sub.current_period_start
    ? sub.current_period_start.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Look for an existing period order for this subscription period.
  const isTest = customer.test === true;
  for (const orderId of customer.orders) {
    const o = await getOrderAny(env, orderId);
    if (o && o.product === "subscription" && o.subscription_period === periodKey &&
        o.subscription_id === sub.stripe_sub_id) {
      return o;
    }
  }

  // Create one.
  const secret = env.UPLOAD_TOKEN_SECRET;
  if (!secret) throw new Error("UPLOAD_TOKEN_SECRET is not configured");
  const orderId = newOrderId();
  const createdAt = new Date().toISOString();
  const order = {
    order_id: orderId,
    customer_email: normalizeEmail(email),
    amount_cents: PLANS[sub.plan].amount_cents,
    product: "subscription",
    subscription_id: sub.stripe_sub_id,
    subscription_period: periodKey,
    plan: sub.plan,
    doc_allowance: sub.allowance,
    status: "paid",
    created_at: createdAt,
    upload_token: await createUploadToken(orderId, secret, UPLOAD_TOKEN_TTL_SECONDS),
    token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    storage_prefix: `orders/${orderId}`,
    stripe_event_id: null,
    files: [],
    pending: [],
    report_files: [],
    issues: [],
    test: isTest,
  };
  await putOrder(env, order, { test: isTest });
  await attachOrderToCustomer(env, email, orderId, { test: isTest });
  return order;
}

/**
 * The order a customer should upload against right now:
 * active subscription -> current period order; else latest pilot order.
 */
export async function currentUploadOrder(env, email) {
  const customer = await getCustomer(env, email);
  if (!customer) return { order: null, customer: null };
  if (activeSubscription(customer.subscription)) {
    const periodOrder = await ensurePeriodOrder(env, email);
    if (periodOrder) return { order: periodOrder, customer, kind: "subscription" };
  }
  // Latest pilot order (most recent first).
  const orders = [];
  for (const orderId of customer.orders) {
    const o = await getOrderAny(env, orderId);
    if (o) orders.push(o);
  }
  orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const pilot = orders.find((o) => o.product === "mini-pilot") || orders[0] || null;
  return { order: pilot, customer, kind: pilot ? pilot.product : null };
}

/** All orders for a customer, newest first. */
export async function listCustomerOrders(env, email) {
  const customer = await getCustomer(env, email);
  if (!customer) return [];
  const orders = [];
  for (const orderId of customer.orders) {
    const o = await getOrderAny(env, orderId);
    if (o) orders.push(o);
  }
  orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return orders;
}

/** Docs used against an order (received + reserved). */
export function docsUsed(order) {
  if (!order) return 0;
  return (order.files ? order.files.length : 0) + (order.pending ? order.pending.length : 0);
}
