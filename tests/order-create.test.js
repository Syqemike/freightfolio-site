/**
 * order-create endpoint tests: auth gate, product gating, idempotency,
 * test-mode isolation. Synthetic only; no live data touched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/order-create.js";
import { getOrderByStripeEvent } from "../lib/order-store.js";
import { mockEnv, mockRequest, readJson } from "./helpers.js";

function authedRequest(body, key = "test-only-internal-key") {
  const req = mockRequest(body);
  req.headers.set("x-intake-key", key);
  return req;
}

describe("order-create endpoint", () => {
  it("rejects requests without the internal key", async () => {
    const env = mockEnv();
    const { status, body } = await onRequestPost({ request: mockRequest({}), env }).then(readJson);
    assert.equal(status, 401);
    assert.equal(body.error, "unauthorized");
  });

  it("rejects a wrong internal key (timing-safe compare)", async () => {
    const env = mockEnv();
    const { status } = await onRequestPost({ request: authedRequest({}, "wrong-key"), env }).then(readJson);
    assert.equal(status, 401);
  });

  it("creates a test order in test mode and skips emails", async () => {
    const env = mockEnv();
    const { status, body } = await onRequestPost({
      request: authedRequest({
        event_id: "evt_oc_test_1",
        customer_email: "pilot@example.com",
        amount_cents: 999,
        product: "mini-pilot",
        test: true,
      }),
      env,
    }).then(readJson);
    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.created, true);
    assert.equal(body.email, "skipped_test_mode");
    const found = await getOrderByStripeEvent(env, "evt_oc_test_1", { test: true });
    assert.ok(found);
    assert.equal(found.test, true);
    // No live keys were written.
    assert.equal((await env.ORDER_KV.list({ prefix: "order:" })).keys.length, 0);
  });

  it("is idempotent: same event id returns the original order", async () => {
    const env = mockEnv();
    const payload = {
      event_id: "evt_oc_dupe_1",
      customer_email: "pilot@example.com",
      amount_cents: 999,
      product: "mini-pilot",
      test: true,
    };
    const first = await onRequestPost({ request: authedRequest(payload), env }).then(readJson);
    const second = await onRequestPost({ request: authedRequest(payload), env }).then(readJson);
    assert.equal(first.body.created, true);
    assert.equal(second.body.created, false);
    assert.equal(second.body.order_id, first.body.order_id);
  });

  it("rejects unsupported products and invalid payloads", async () => {
    const env = mockEnv();
    const badProduct = await onRequestPost({
      request: authedRequest({ product: "starter", customer_email: "a@b.co", amount_cents: 3900, test: true }),
      env,
    }).then(readJson);
    assert.equal(badProduct.status, 400);

    const badEmail = await onRequestPost({
      request: authedRequest({ customer_email: "nope", amount_cents: 999, test: true }),
      env,
    }).then(readJson);
    assert.equal(badEmail.status, 400);
  });

  it("returns 500 when INTAKE_INTERNAL_KEY is not configured", async () => {
    const env = mockEnv({ INTAKE_INTERNAL_KEY: "" });
    const { status } = await onRequestPost({ request: mockRequest({}), env }).then(readJson);
    assert.equal(status, 500);
  });
});
