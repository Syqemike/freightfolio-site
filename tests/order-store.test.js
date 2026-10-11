/**
 * Order store tests: schema validation, order creation, Stripe idempotency,
 * test-mode key isolation. Synthetic only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createOrderFromPayment,
  validateOrder,
  getOrder,
  getOrderByStripeEvent,
  newOrderId,
} from "../lib/order-store.js";
import { mockEnv } from "./helpers.js";

function payment(overrides = {}) {
  return {
    eventId: "evt_test_" + Math.random().toString(36).slice(2),
    customerEmail: "broker@example.com",
    amountCents: 999,
    ...overrides,
  };
}

describe("order id generation", () => {
  it("produces unguessable 128-bit ids", () => {
    const a = newOrderId();
    const b = newOrderId();
    assert.match(a, /^ord_[0-9a-f]{32}$/);
    assert.notEqual(a, b);
  });
});

describe("order schema validation", () => {
  it("accepts a well-formed order", async () => {
    const env = mockEnv();
    const { order } = await createOrderFromPayment(env, payment());
    assert.equal(validateOrder(order).ok, true);
  });

  it("rejects malformed orders", () => {
    const base = {
      order_id: "ord_" + "e".repeat(32),
      customer_email: "a@b.co",
      amount_cents: 999,
      product: "mini-pilot",
      doc_allowance: 10,
      status: "paid",
      created_at: new Date().toISOString(),
      upload_token: "ord_x",
      token_expires_at: new Date().toISOString(),
      storage_prefix: "orders/ord_" + "e".repeat(32),
      stripe_event_id: null,
      files: [],
      pending: [],
      test: false,
    };
    assert.equal(validateOrder({ ...base, order_id: "bad" }).reason, "bad_order_id");
    assert.equal(validateOrder({ ...base, customer_email: "not-an-email" }).reason, "bad_email");
    assert.equal(validateOrder({ ...base, amount_cents: -5 }).reason, "bad_amount");
    assert.equal(validateOrder({ ...base, product: "starter" }).reason, "bad_product");
    assert.equal(validateOrder({ ...base, status: "shipped" }).reason, "bad_status");
    assert.equal(validateOrder({ ...base, storage_prefix: "evil/x" }).reason, "bad_storage_prefix");
    assert.equal(validateOrder(null).reason, "not_an_object");
  });
});

describe("createOrderFromPayment", () => {
  it("creates an order with token, 7-day expiry, and 10-doc allowance", async () => {
    const env = mockEnv();
    const { order, created } = await createOrderFromPayment(env, payment());
    assert.equal(created, true);
    assert.equal(order.product, "mini-pilot");
    assert.equal(order.doc_allowance, 10);
    assert.equal(order.status, "paid");
    assert.ok(order.upload_token.startsWith("ord_"));
    const ttlMs = new Date(order.token_expires_at) - new Date(order.created_at);
    assert.ok(Math.abs(ttlMs - 7 * 24 * 60 * 60 * 1000) < 60 * 1000);
    assert.equal(order.storage_prefix, `orders/${order.order_id}`);
    assert.equal(order.test, false);
  });

  it("is idempotent on the Stripe event id (no duplicate order)", async () => {
    const env = mockEnv();
    const p = payment({ eventId: "evt_test_dupe_1" });
    const first = await createOrderFromPayment(env, p);
    const second = await createOrderFromPayment(env, p);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.order.order_id, first.order.order_id);
    const listed = await env.ORDER_KV.list({ prefix: "order:" });
    assert.equal(listed.keys.length, 1);
  });

  it("resolves orders by Stripe event id", async () => {
    const env = mockEnv();
    const p = payment({ eventId: "evt_test_lookup_1" });
    const { order } = await createOrderFromPayment(env, p);
    const found = await getOrderByStripeEvent(env, "evt_test_lookup_1");
    assert.equal(found.order_id, order.order_id);
    assert.equal(await getOrderByStripeEvent(env, "evt_test_missing"), null);
  });

  it("test mode isolates keys and marks the order", async () => {
    const env = mockEnv();
    const { order } = await createOrderFromPayment(env, payment({ test: true }));
    assert.equal(order.test, true);
    assert.equal(await getOrder(env, order.order_id, { test: false }), null);
    assert.ok(await getOrder(env, order.order_id, { test: true }));
    const liveKeys = (await env.ORDER_KV.list({ prefix: "order:" })).keys;
    assert.equal(liveKeys.length, 0, "no live keys should exist in test mode");
  });

  it("rejects bad emails and amounts without writing anything", async () => {
    const env = mockEnv();
    await assert.rejects(createOrderFromPayment(env, payment({ customerEmail: "bad" })), /invalid customer email/);
    await assert.rejects(createOrderFromPayment(env, payment({ amountCents: 0 })), /invalid amount/);
    assert.equal((await env.ORDER_KV.list({ prefix: "order:" })).keys.length, 0);
  });

  it("requires UPLOAD_TOKEN_SECRET", async () => {
    const env = mockEnv({ UPLOAD_TOKEN_SECRET: "" });
    await assert.rejects(createOrderFromPayment(env, payment()), /UPLOAD_TOKEN_SECRET/);
  });
});
