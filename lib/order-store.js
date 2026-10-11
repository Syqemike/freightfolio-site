/**
 * lib/order-store.js — order record storage abstraction for the intake flow.
 *
 * Backend interface is Cloudflare KV. The required binding name is ORDER_KV
 * (a KV namespace created in the Cloudflare dashboard — NOT provisioned here,
 * because the dashboard is bot-challenged for automation).
 *
 * Order record schema:
 * {
 *   order_id:        "ord_<32 hex chars>"  (128-bit crypto-random, unguessable)
 *   customer_email:  string
 *   amount_cents:    number  (999 for the mini-pilot)
 *   product:         "mini-pilot"
 *   doc_allowance:   number  (10 for the mini-pilot)
 *   status:          "paid" | "uploading" | "received" | "processing" | "delivered"
 *   created_at:      ISO 8601 string
 *   upload_token:    string  (HMAC-signed, see lib/tokens.js)
 *   token_expires_at: ISO 8601 string (created_at + 7 days)
 *   storage_prefix:  "orders/<order_id>"
 *   stripe_event_id: string  (idempotency source; may be null for manual orders)
 *   files:           [{ sha256, filename, key, size_bytes, received_at }]
 *   pending:         [{ sha256, key, filename, reserved_at }]  (upload slots reserved by upload-init)
 *   test:            boolean (true => synthetic; keys prefixed "test:")
 * }
 *
 * Key layout in KV:
 *   order:<order_id>          -> order JSON
 *   stripe_evt:<event_id>     -> order_id (Stripe idempotency dedupe; TTL 90 days)
 *   email:<sha256(email)>     -> latest order_id for that customer (lookup aid)
 *   (test mode prefixes every key with "test:")
 */

import { createUploadToken, UPLOAD_TOKEN_TTL_SECONDS } from "./tokens.js";

export const DOC_ALLOWANCE_MINI_PILOT = 10;
export const PRODUCT_MINI_PILOT = "mini-pilot";
export const TOKEN_TTL_DAYS = 7;

const VALID_STATUSES = new Set(["paid", "uploading", "received", "processing", "delivered", "needs_attention", "refunded", "disputed"]);
const VALID_PRODUCTS = new Set([PRODUCT_MINI_PILOT, "subscription"]);

function assertKv(env) {
  if (!env.ORDER_KV) {
    throw new Error(
      "ORDER_KV KV binding is missing. Create the 'ORDER_KV' KV namespace in the " +
        "Cloudflare dashboard and bind it to this Pages project (see wiring-checklist.md)."
    );
  }
  return env.ORDER_KV;
}

function key(env, name, test) {
  void env;
  return test ? `test:${name}` : name;
}

export async function sha256HexAsync(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newOrderId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "ord_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate an order record shape. Returns {ok:true} or {ok:false, reason}.
 */
export function validateOrder(order) {
  if (!order || typeof order !== "object") return { ok: false, reason: "not_an_object" };
  if (typeof order.order_id !== "string" || !/^ord_[0-9a-f]{32}$/.test(order.order_id))
    return { ok: false, reason: "bad_order_id" };
  if (typeof order.customer_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer_email))
    return { ok: false, reason: "bad_email" };
  if (!Number.isInteger(order.amount_cents) || order.amount_cents <= 0)
    return { ok: false, reason: "bad_amount" };
  if (!VALID_PRODUCTS.has(order.product)) return { ok: false, reason: "bad_product" };
  if (!Number.isInteger(order.doc_allowance) || order.doc_allowance <= 0)
    return { ok: false, reason: "bad_allowance" };
  if (!VALID_STATUSES.has(order.status)) return { ok: false, reason: "bad_status" };
  if (typeof order.upload_token !== "string" || !order.upload_token.startsWith("ord_"))
    return { ok: false, reason: "bad_token" };
  if (typeof order.storage_prefix !== "string" || !order.storage_prefix.startsWith("orders/ord_"))
    return { ok: false, reason: "bad_storage_prefix" };
  if (!Array.isArray(order.files) || !Array.isArray(order.pending))
    return { ok: false, reason: "bad_files" };
  return { ok: true };
}

export async function getOrder(env, orderId, { test = false } = {}) {
  const kv = assertKv(env);
  const raw = await kv.get(key(env, `order:${orderId}`, test));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putOrder(env, order, { test = false } = {}) {
  const kv = assertKv(env);
  const v = validateOrder(order);
  if (!v.ok) throw new Error(`putOrder: invalid order (${v.reason})`);
  await kv.put(key(env, `order:${order.order_id}`, test), JSON.stringify(order));
}

/**
 * Idempotency: record a Stripe event id -> order id mapping (TTL 90 days).
 * Returns the existing order id if this event was already processed, else null.
 */
export async function claimStripeEvent(env, eventId, orderId, { test = false } = {}) {
  const kv = assertKv(env);
  const k = key(env, `stripe_evt:${eventId}`, test);
  const existing = await kv.get(k);
  if (existing) return existing;
  await kv.put(k, orderId, { expirationTtl: 90 * 24 * 60 * 60 });
  return null;
}

export async function getOrderByStripeEvent(env, eventId, { test = false } = {}) {
  const kv = assertKv(env);
  const orderId = await kv.get(key(env, `stripe_evt:${eventId}`, test));
  if (!orderId) return null;
  return getOrder(env, orderId, { test });
}

/**
 * Payment-intent -> order lookup for refund/chargeback handling.
 * The mapping is written at order creation; lookups are used by the
 * charge.refunded / charge.dispute.created webhook branches.
 */
export async function claimStripePaymentIntent(env, paymentIntentId, orderId, { test = false } = {}) {
  const kv = assertKv(env);
  if (!paymentIntentId || !orderId) return;
  await kv.put(key(env, `stripe_pi:${paymentIntentId}`, test), orderId);
}

export async function getOrderByStripePI(env, paymentIntentId, { test = false } = {}) {
  const kv = assertKv(env);
  if (!paymentIntentId) return null;
  const orderId = await kv.get(key(env, `stripe_pi:${paymentIntentId}`, test));
  if (!orderId) return null;
  return getOrder(env, orderId, { test });
}

/**
 * Create an order record from a VERIFIED Stripe payment.
 * Callers must have already verified the Stripe event signature / charge state —
 * this function never trusts browser input, only the `payment` argument passed
 * server-side from the webhook or stripe-watch.
 *
 * Idempotent on stripe_event_id: a repeated call with the same event id returns
 * the original order without creating a duplicate.
 *
 * @param {object} env  Pages env (needs ORDER_KV, UPLOAD_TOKEN_SECRET)
 * @param {{eventId:string|null, customerEmail:string, amountCents:number, test?:boolean}} payment
 */
export async function createOrderFromPayment(env, payment) {
  const secret = env.UPLOAD_TOKEN_SECRET;
  if (!secret) throw new Error("UPLOAD_TOKEN_SECRET is not configured");
  const test = payment.test === true;

  const email = String(payment.customerEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid customer email");
  if (!Number.isInteger(payment.amountCents) || payment.amountCents <= 0)
    throw new Error("invalid amount");

  // Idempotency first: never create a second order for the same Stripe event.
  if (payment.eventId) {
    const existingId = await claimStripeEvent(env, payment.eventId, "__pending__", { test });
    if (existingId && existingId !== "__pending__") {
      const existing = await getOrder(env, existingId, { test });
      if (existing) return { order: existing, created: false };
    }
  }

  const orderId = newOrderId();
  const createdAt = new Date().toISOString();
  const uploadToken = await createUploadToken(orderId, secret, UPLOAD_TOKEN_TTL_SECONDS);

  const order = {
    order_id: orderId,
    customer_email: email,
    amount_cents: payment.amountCents,
    product: PRODUCT_MINI_PILOT,
    doc_allowance: DOC_ALLOWANCE_MINI_PILOT,
    status: "paid",
    created_at: createdAt,
    upload_token: uploadToken,
    token_expires_at: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    storage_prefix: `orders/${orderId}`,
    stripe_event_id: payment.eventId || null,
    files: [],
    pending: [],
    test,
  };

  const v = validateOrder(order);
  if (!v.ok) throw new Error(`order validation failed: ${v.reason}`);
  await putOrder(env, order, { test });

  // Point the idempotency record at the real order id (overwrite the placeholder).
  if (payment.eventId) {
    const kv = assertKv(env);
    await kv.put(key(env, `stripe_evt:${payment.eventId}`, test), orderId, {
      expirationTtl: 90 * 24 * 60 * 60,
    });
  }
  // Payment-intent mapping for refund/chargeback lookup (no TTL; refunds
  // can arrive months later, well beyond the 90-day event dedupe window).
  if (payment.paymentIntentId) {
    order.stripe_payment_intent = payment.paymentIntentId;
    await putOrder(env, order, { test });
    await claimStripePaymentIntent(env, payment.paymentIntentId, orderId, { test });
  }
  // Customer lookup aid: email hash -> JSON array of order IDs (newest last).
  // Stores all orders per customer so repeat customers can resend links for
  // any of their orders, not just the latest.
  const emailHash = await sha256HexAsync(email);
  const emailKey = key(env, `email:${emailHash}`, test);
  let orderIds = [];
  try {
    const existing = await assertKv(env).get(emailKey);
    if (existing) {
      const parsed = JSON.parse(existing);
      orderIds = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {
    orderIds = [];
  }
  if (!orderIds.includes(orderId)) {
    orderIds.push(orderId);
  }
  // Cap at 50 orders per email to bound KV value size.
  orderIds = orderIds.slice(-50);
  await assertKv(env).put(emailKey, JSON.stringify(orderIds), {
    expirationTtl: 90 * 24 * 60 * 60,
  });

  return { order, created: true };
}

/**
 * Update processing status + report/issue metadata on an order.
 * Used by the internal status endpoint (processing bridge / admin).
 * Only honest statuses are accepted; report_files and issues must be arrays.
 */
const INTERNAL_STATUSES = new Set(["received", "processing", "needs_attention", "delivered"]);

export async function updateOrderStatus(env, orderId, { status, report_files, issues, note } = {}) {
  const kv = assertKv(env);
  void kv;
  let order = await getOrder(env, orderId, { test: false });
  let test = false;
  if (!order) {
    order = await getOrder(env, orderId, { test: true });
    test = true;
  }
  if (!order) return { ok: false, error: "unknown_order" };
  if (status !== undefined) {
    if (!INTERNAL_STATUSES.has(status)) return { ok: false, error: "bad_status" };
    order.status = status;
    if (status === "delivered") order.delivered_at = new Date().toISOString();
  }
  if (report_files !== undefined) {
    if (!Array.isArray(report_files)) return { ok: false, error: "bad_report_files" };
    order.report_files = report_files
      .filter((f) => f && typeof f.key === "string" && f.key.startsWith(`orders/${orderId}/`))
      .map((f) => ({
        key: f.key,
        name: String(f.name || f.key.split("/").pop()).slice(0, 120),
        size_bytes: Number.isInteger(f.size_bytes) ? f.size_bytes : null,
        uploaded_at: f.uploaded_at || new Date().toISOString(),
      }));
  }
  if (issues !== undefined) {
    if (!Array.isArray(issues)) return { ok: false, error: "bad_issues" };
    order.issues = issues.slice(0, 200).map((i) => ({
      type: String(i.type || "note").slice(0, 40),
      severity: ["low", "medium", "high"].includes(i.severity) ? i.severity : "medium",
      load: String(i.load || "").slice(0, 80),
      message: String(i.message || "").slice(0, 500),
      recommendation: String(i.recommendation || "").slice(0, 500),
      // Sources: "pipeline" (bridge), "admin" (ops console), "recovery"
      // (missing-document recovery system, via the internal status channel).
      source: i.source === "admin" ? "admin" : i.source === "recovery" ? "recovery" : "pipeline",
      created_at: i.created_at || new Date().toISOString(),
    }));
  }
  if (note !== undefined) {
    order.ops_notes = order.ops_notes || [];
    order.ops_notes.push({ at: new Date().toISOString(), note: String(note).slice(0, 500) });
  }
  await putOrder(env, order, { test });
  return { ok: true, order_id: orderId, status: order.status, test };
}

/** Append an admin audit entry. */
export async function logAdminAction(env, { actor, action, target, detail }) {
  const kv = assertKv(env);
  const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await kv.put(
    `admin_audit:${id}`,
    JSON.stringify({
      at: new Date().toISOString(),
      actor: String(actor || "").slice(0, 120),
      action: String(action || "").slice(0, 60),
      target: String(target || "").slice(0, 120),
      detail: String(detail || "").slice(0, 500),
    }),
    { expirationTtl: 365 * 24 * 60 * 60 }
  );
}
