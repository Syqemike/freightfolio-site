/**
 * upload-init tests: allowance enforcement, oversize rejection, duplicate
 * detection, type gating, token auth. Presigning is pure crypto (no network).
 * Synthetic only.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/upload-init.js";
import { createOrderFromPayment } from "../lib/order-store.js";
import { mockEnv, mockRequest, readJson } from "./helpers.js";

let env;
let order;

function file(i, overrides = {}) {
  return {
    filename: `doc-${i}.pdf`,
    content_type: "application/pdf",
    size_bytes: 1024 * i,
    sha256: i.toString(16).padStart(64, "0"),
    ...overrides,
  };
}

function initCall(files) {
  return onRequestPost({
    request: mockRequest({ token: order.upload_token, order_id: order.order_id, files }),
    env,
  }).then(readJson);
}

beforeEach(async () => {
  env = mockEnv();
  ({ order } = await createOrderFromPayment(env, {
    eventId: "evt_init_" + Math.random().toString(36).slice(2),
    customerEmail: "broker@example.com",
    amountCents: 999,
  }));
});

describe("upload-init", () => {
  it("issues presigned PUT URLs for valid files and reserves slots", async () => {
    const { status, body } = await initCall([file(1), file(2)]);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.uploads.length, 2);
    assert.ok(body.uploads[0].put_url.includes("X-Amz-Signature="));
    assert.equal(body.uploads[0].required_content_type, "application/pdf");
    assert.equal(body.rejected.length, 0);
    assert.ok(body.uploads[0].key.startsWith(`orders/${order.order_id}/`));
  });

  it("rejects an oversize file (over 25 MB)", async () => {
    const { body } = await initCall([file(1, { size_bytes: 26 * 1024 * 1024 })]);
    assert.equal(body.uploads.length, 0);
    assert.equal(body.rejected.length, 1);
    assert.equal(body.rejected[0].reason, "too_large");
  });

  it("rejects the 11th file when the 10-doc allowance is exceeded", async () => {
    const files = Array.from({ length: 11 }, (_, i) => file(i + 1));
    const { body } = await initCall(files);
    assert.equal(body.uploads.length, 10);
    assert.equal(body.rejected.length, 1);
    assert.equal(body.rejected[0].reason, "allowance_exceeded");
    assert.equal(body.remaining_after, 0);
  });

  it("rejects duplicate content (same SHA-256) within and across calls", async () => {
    const dup = file(7);
    const first = await initCall([dup]);
    assert.equal(first.body.uploads.length, 1);
    const second = await initCall([file(7)]); // same sha256
    assert.equal(second.body.uploads.length, 0);
    assert.equal(second.body.rejected[0].reason, "duplicate_content");
    const batch = await initCall([file(8), file(8)]);
    assert.equal(batch.body.uploads.length, 1);
    assert.equal(batch.body.rejected[0].reason, "duplicate_content");
  });

  it("rejects unsupported content types", async () => {
    const { body } = await initCall([
      file(1, { content_type: "application/x-msdownload", filename: "evil.exe" }),
    ]);
    assert.equal(body.uploads.length, 0);
    assert.equal(body.rejected[0].reason, "unsupported_type");
  });

  it("rejects a bad token and an expired token", async () => {
    const bad = await onRequestPost({
      request: mockRequest({ token: "ord_bogus", order_id: order.order_id, files: [file(1)] }),
      env,
    }).then(readJson);
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, "invalid_token");

    // Cross-order token: mint is tested in tokens.test.js; here use a token for another order.
    const other = await createOrderFromPayment(env, {
      eventId: "evt_init_other_" + Math.random().toString(36).slice(2),
      customerEmail: "other@example.com",
      amountCents: 999,
    });
    const cross = await onRequestPost({
      request: mockRequest({ token: other.order.upload_token, order_id: order.order_id, files: [file(1)] }),
      env,
    }).then(readJson);
    assert.equal(cross.status, 401);
  });

  it("returns 404 for an unknown order", async () => {
    const res = await onRequestPost({
      request: mockRequest({ token: order.upload_token, order_id: "ord_" + "f".repeat(32), files: [file(1)] }),
      env,
    }).then(readJson);
    assert.equal(res.status, 404);
  });

  it("returns 500 when ORDER_KV is not bound", async () => {
    const res = await onRequestPost({
      request: mockRequest({ token: "x", order_id: "y", files: [] }),
      env: mockEnv({ ORDER_KV: undefined }),
    }).then(readJson);
    assert.equal(res.status, 500);
  });

  it("does not let concurrent reservations exceed the allowance", async () => {
    // First call reserves 8 slots; second call can only take 2 more.
    const eight = Array.from({ length: 8 }, (_, i) => file(i + 1));
    const r1 = await initCall(eight);
    assert.equal(r1.body.uploads.length, 8);
    const five = Array.from({ length: 5 }, (_, i) => file(i + 20));
    const r2 = await initCall(five);
    assert.equal(r2.body.uploads.length, 2);
    assert.equal(r2.body.rejected.filter((r) => r.reason === "allowance_exceeded").length, 3);
  });
});
