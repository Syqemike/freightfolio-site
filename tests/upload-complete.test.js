/**
 * upload-complete tests. The B2 ranged-GET and Resend calls are stubbed at
 * global fetch: no network, synthetic data only.
 *
 * Covered: token auth failures, unreserved-key rejection, hash mismatch, the
 * full happy path (HEAD exists -> magic bytes OK -> status "received" ->
 * confirmation + ops emails sent via stubbed Resend).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as completePost } from "../functions/api/upload-complete.js";
import { onRequestPost as initPost } from "../functions/api/upload-init.js";
import { createOrderFromPayment, getOrder } from "../lib/order-store.js";
import { mockEnv, mockRequest, readJson } from "./helpers.js";

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const EXE_HEAD = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

let realFetch;
let headBytes = PDF_HEAD; // what the stubbed bucket "contains"

function stubFetch() {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("api.resend.com")) {
      return new Response(JSON.stringify({ id: "re_test_123" }), { status: 200 });
    }
    const range = opts.headers && opts.headers.Range;
    if (range === "bytes=0-0") {
      return new Response(new Uint8Array([headBytes[0]]), {
        status: 206,
        headers: { "content-range": "bytes 0-0/1234", "content-type": "application/octet-stream" },
      });
    }
    if (range === "bytes=0-7") {
      return new Response(headBytes.slice(0, 8), {
        status: 206,
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return new Response(null, { status: 404 });
  };
}

let env;
let order;

beforeEach(async () => {
  stubFetch();
  headBytes = PDF_HEAD;
  env = mockEnv({ RESEND_API_KEY: "re_test_key" });
  ({ order } = await createOrderFromPayment(env, {
    eventId: "evt_complete_" + Math.random().toString(36).slice(2),
    customerEmail: "broker@example.com",
    amountCents: 999,
  }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function reserve(files) {
  const res = await initPost({
    request: mockRequest({ token: order.upload_token, order_id: order.order_id, files }),
    env,
  }).then(readJson);
  return res.body.uploads;
}

function completeCall(uploads, token = order.upload_token, orderId = order.order_id) {
  return completePost({
    request: mockRequest({ token, order_id: orderId, uploads }),
    env,
  }).then(readJson);
}

describe("upload-complete", () => {
  it("rejects a bad token", async () => {
    const { status, body } = await completeCall([], "ord_bogus");
    assert.equal(status, 401);
    assert.equal(body.error, "invalid_token");
  });

  it("returns 404 for an unknown order", async () => {
    const { status } = await completeCall([], order.upload_token, "ord_" + "f".repeat(32));
    assert.equal(status, 404);
  });

  it("rejects keys never reserved for this order (cross-order claim attempt)", async () => {
    const { status, body } = await completeCall([
      { sha256: "a".repeat(64), key: `orders/${order.order_id}/${"a".repeat(64)}/hijack.pdf` },
    ]);
    assert.equal(status, 200);
    assert.equal(body.received, 0);
    assert.equal(body.rejected[0].reason, "unreserved_key");
  });

  it("rejects a sha256 that does not match the reserved slot", async () => {
    const uploads = await reserve([
      { filename: "bol.pdf", content_type: "application/pdf", size_bytes: 100, sha256: "b".repeat(64) },
    ]);
    const { body } = await completeCall([{ sha256: "c".repeat(64), key: uploads[0].key }]);
    assert.equal(body.received, 0);
    assert.equal(body.rejected[0].reason, "hash_mismatch");
  });

  it("completes the happy path: verifies, records, marks received, emails", async () => {
    const uploads = await reserve([
      { filename: "bol.pdf", content_type: "application/pdf", size_bytes: 100, sha256: "b".repeat(64) },
      { filename: "pod.jpg", content_type: "image/jpeg", size_bytes: 200, sha256: "e".repeat(64) },
    ]);
    const { status, body } = await completeCall(
      uploads.map((u) => ({ sha256: u.sha256, key: u.key }))
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.received, 2);
    assert.equal(body.status, "received");
    assert.equal(body.email, "sent");

    const stored = await getOrder(env, order.order_id);
    assert.equal(stored.status, "received");
    assert.equal(stored.files.length, 2);
    assert.equal(stored.files[0].detected_type, "pdf");
    assert.equal(stored.pending.length, 0);
  });

  it("rejects an object whose magic bytes are not PDF/JPG/PNG (renamed exe)", async () => {
    headBytes = EXE_HEAD;
    const uploads = await reserve([
      { filename: "totally-a-pdf.pdf", content_type: "application/pdf", size_bytes: 100, sha256: "b".repeat(64) },
    ]);
    const { body } = await completeCall([{ sha256: "b".repeat(64), key: uploads[0].key }]);
    assert.equal(body.received, 0);
    assert.equal(body.rejected[0].reason, "bad_file_type");
  });

  it("dedupes content at finalize time (race guard)", async () => {
    const { putOrder } = await import("../lib/order-store.js");
    const uploads = await reserve([
      { filename: "a.pdf", content_type: "application/pdf", size_bytes: 100, sha256: "b".repeat(64) },
    ]);
    assert.equal(uploads.length, 1);
    // Simulate the race: another request finalized the same content first.
    const raced = await getOrder(env, order.order_id);
    raced.files.push({
      sha256: "b".repeat(64),
      filename: "a-first.pdf",
      key: uploads[0].key,
      size_bytes: 100,
      received_at: new Date().toISOString(),
      detected_type: "pdf",
    });
    await putOrder(env, raced);
    const { body } = await completeCall([{ sha256: "b".repeat(64), key: uploads[0].key }]);
    assert.equal(body.received, 0);
    assert.equal(body.rejected[0].reason, "duplicate_content");
  });
});
