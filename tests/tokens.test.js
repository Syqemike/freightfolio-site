/**
 * Token tests: create/verify/expiry/wrong-secret/cross-order-reuse.
 * Synthetic only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createUploadToken,
  verifyUploadToken,
  timingSafeEqualBytes,
  UPLOAD_TOKEN_TTL_SECONDS,
} from "../lib/tokens.js";

const SECRET = "test-secret-abc-123";
const ORDER_A = "ord_" + "a".repeat(32);
const ORDER_B = "ord_" + "b".repeat(32);

describe("upload tokens", () => {
  it("creates a token that verifies for the same order", async () => {
    const token = await createUploadToken(ORDER_A, SECRET);
    const v = await verifyUploadToken(token, ORDER_A, SECRET);
    assert.equal(v.ok, true);
    assert.equal(v.orderId, ORDER_A);
  });

  it("rejects an expired token", async () => {
    const token = await createUploadToken(ORDER_A, SECRET, 1); // 1-second TTL
    const future = Math.floor(Date.now() / 1000) + 60;
    const v = await verifyUploadToken(token, ORDER_A, SECRET, future);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "expired");
  });

  it("rejects a token verified with the wrong secret", async () => {
    const token = await createUploadToken(ORDER_A, SECRET);
    const v = await verifyUploadToken(token, ORDER_A, "different-secret");
    assert.equal(v.ok, false);
    assert.equal(v.reason, "bad_signature");
  });

  it("rejects cross-order reuse", async () => {
    const token = await createUploadToken(ORDER_A, SECRET);
    const v = await verifyUploadToken(token, ORDER_B, SECRET);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "order_mismatch");
  });

  it("rejects a tampered token", async () => {
    const token = await createUploadToken(ORDER_A, SECRET);
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    const v = await verifyUploadToken(tampered, ORDER_A, SECRET);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "bad_signature");
  });

  it("rejects malformed tokens", async () => {
    for (const bad of ["", "ord_", "ord_not.enough", "nope", null, undefined]) {
      const v = await verifyUploadToken(bad, ORDER_A, SECRET);
      assert.equal(v.ok, false, `expected rejection for ${String(bad)}`);
    }
  });

  it("rejects verification when the secret is missing", async () => {
    const token = await createUploadToken(ORDER_A, SECRET);
    const v = await verifyUploadToken(token, ORDER_A, "");
    assert.equal(v.ok, false);
    assert.equal(v.reason, "secret_missing");
  });

  it("default TTL is 7 days", () => {
    assert.equal(UPLOAD_TOKEN_TTL_SECONDS, 7 * 24 * 60 * 60);
  });

  it("timingSafeEqualBytes compares in constant time fashion", () => {
    assert.equal(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
    assert.equal(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
    assert.equal(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
  });
});
