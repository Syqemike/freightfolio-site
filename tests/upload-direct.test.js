/**
 * upload-direct tests: proxied upload (browser -> Function -> B2 native API).
 * B2 HTTP calls are stubbed. Synthetic only.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/upload-direct.js";
import { onRequestPost as internalTestOrder } from "../functions/api/internal/test-order.js";
import { createSession } from "../lib/session.js";
import { getOrder } from "../lib/order-store.js";
import { _clearB2AuthCache } from "../lib/b2-native.js";
import { mockEnv, readJson } from "./helpers.js";

const INTERNAL_KEY = "test-only-internal-key";

let env;
let realFetch;

function stubB2() {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("b2_authorize_account")) {
      return Response.json({
        authorizationToken: "test-auth-token",
        apiInfo: { storageApi: { apiUrl: "https://api.test", downloadUrl: "https://dl.test" } },
        accountId: "test-account",
      });
    }
    if (u.includes("b2_get_upload_url")) {
      return Response.json({ uploadUrl: "https://upload.test/b2api/v3/b2_upload_file", authorizationToken: "test-uptok" });
    }
    if (u === "https://upload.test/b2api/v3/b2_upload_file") {
      return Response.json({ fileId: "test-file-id", fileName: "orders/ord_x/test.pdf" });
    }
    throw new Error("unexpected fetch: " + u);
  };
}

function unstickB2() {
  globalThis.fetch = realFetch;
  _clearB2AuthCache();
}

// Minimal valid PDF bytes (just the magic header + some content).
function pdfBytes(seed = 1) {
  const head = Buffer.from("%PDF-1.4\n");
  const body = Buffer.from(`test content ${seed}\n`.repeat(20));
  return new Uint8Array(Buffer.concat([head, body]));
}

async function makeOrder(email) {
  const r = await internalTestOrder({
    request: new Request("https://test.freightfolio.net/api/internal/test-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ internal_key: INTERNAL_KEY, email }),
    }),
    env,
  });
  const { body } = await readJson(r);
  assert.equal(body.ok, true);
  return body.order_id;
}

async function sessionCookie(email) {
  const s = await createSession(env, email, "customer");
  return s.cookieValue;
}

function directCall({ orderId, cookie, fileBytes, filename = "doc.pdf", token = "" }) {
  const fd = new FormData();
  fd.append("order_id", orderId);
  if (token) fd.append("token", token);
  fd.append("file", new Blob([fileBytes], { type: "application/pdf" }), filename);
  const headers = {};
  if (cookie) headers.cookie = `ff_session=${cookie}`;
  return onRequestPost({
    request: new Request("https://test.freightfolio.net/api/upload-direct", {
      method: "POST",
      headers,
      body: fd,
    }),
    env,
  }).then(readJson);
}

beforeEach(async () => {
  env = mockEnv({ B2_BUCKET_ID: "test-bucket-id-0001", SESSION_SECRET: "test-session-secret-32bytes-long!!" });
  stubB2();
});

afterEach(() => {
  unstickB2();
});

describe("upload-direct", () => {
  it("uploads a valid PDF via session auth and records it", async () => {
    const email = "direct@example.com";
    const orderId = await makeOrder(email);
    const cookie = await sessionCookie(email);

    const { status, body } = await directCall({ orderId, cookie, fileBytes: pdfBytes(1) });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.file.filename, "doc.pdf");
    assert.equal(body.file.detected_type, "pdf");
    assert.match(body.file.sha256, /^[0-9a-f]{64}$/);

    const order = await getOrder(env, orderId, { test: true });
    assert.equal(order.files.length, 1);
    assert.equal(order.status, "received");
    assert.ok(order.files[0].key.startsWith(`orders/${orderId}/`));
  });

  it("rejects non-PDF/JPG/PNG content by magic bytes", async () => {
    const email = "badmagic@example.com";
    const orderId = await makeOrder(email);
    const cookie = await sessionCookie(email);

    const { status, body } = await directCall({
      orderId, cookie,
      fileBytes: new Uint8Array(Buffer.from("MZ fake exe content")),
      filename: "totally-a-pdf.pdf",
    });
    assert.equal(status, 400);
    assert.equal(body.error, "bad_file_type");
  });

  it("rejects duplicate content", async () => {
    const email = "dup@example.com";
    const orderId = await makeOrder(email);
    const cookie = await sessionCookie(email);
    const { getOrder, putOrder } = await import("../lib/order-store.js");

    const first = await directCall({ orderId, cookie, fileBytes: pdfBytes(2) });
    assert.equal(first.body.ok, true);

    const second = await directCall({ orderId, cookie, fileBytes: pdfBytes(2), filename: "other-name.pdf" });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "duplicate_content");
  });

  it("rejects when the allowance is exhausted", async () => {
    const email = "full@example.com";
    const orderId = await makeOrder(email);
    const cookie = await sessionCookie(email);
    const { getOrder, putOrder } = await import("../lib/order-store.js");
    // Pre-fill 10 recorded files directly (receipt closes the order per upload,
    // so simulate a full allowance without 10 separate receipts).
    const o = await getOrder(env, orderId, { test: true });
    o.files = Array.from({ length: 10 }, (_, i) => ({
      sha256: (200 + i).toString(16).padStart(64, "0"),
      filename: `d${i}.pdf`,
      key: `orders/${orderId}/pre/d${i}.pdf`,
      size_bytes: 100,
      received_at: new Date().toISOString(),
      detected_type: "pdf",
    }));
    o.status = "paid";
    await putOrder(env, o, { test: true });

    const over = await directCall({ orderId, cookie, fileBytes: pdfBytes(999), filename: "extra.pdf" });
    assert.equal(over.status, 409);
    assert.equal(over.body.error, "allowance_exhausted");
  });

  it("rejects oversize files", async () => {
    const email = "big@example.com";
    const orderId = await makeOrder(email);
    const cookie = await sessionCookie(email);

    const big = new Uint8Array(26 * 1024 * 1024); // 26 MB of zeros (not a PDF, but size check comes first)
    const { status, body } = await directCall({ orderId, cookie, fileBytes: big });
    assert.equal(status, 400);
    assert.equal(body.error, "too_large");
  });

  it("requires auth (no session, no token)", async () => {
    const orderId = await makeOrder("noauth@example.com");
    const { status } = await directCall({ orderId, fileBytes: pdfBytes(3) });
    assert.equal(status, 401);
  });

  it("sends the required X-Bz-Content-Sha1 header to B2", async () => {
    // B2 rejects native uploads without a valid SHA-1 checksum header.
    const email = "sha1@example.com";
    const orderId = await makeOrder(email);
    const cookie = await sessionCookie(email);

    let capturedHeaders = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url) === "https://upload.test/b2api/v3/b2_upload_file") {
        capturedHeaders = opts.headers;
      }
      return origFetch(url, opts);
    };
    try {
      const bytes = pdfBytes(7);
      const { status, body } = await directCall({ orderId, cookie, fileBytes: bytes });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.ok(capturedHeaders, "upload PUT was issued");
      const sha1 = capturedHeaders["X-Bz-Content-Sha1"];
      assert.match(sha1, /^[0-9a-f]{40}$/);
      const { createHash } = await import("node:crypto");
      assert.equal(sha1, createHash("sha1").update(Buffer.from(bytes)).digest("hex"));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("returns 500 when B2_BUCKET_ID is not configured", async () => {
    const envNoBucket = mockEnv({ SESSION_SECRET: "test-session-secret-32bytes-long!!" }); // no B2_BUCKET_ID = mockEnv({ SESSION_SECRET: "test-session-secret-32bytes-long!!" }); // no B2_BUCKET_ID
    const email = "nobucket@example.com";
    const r = await internalTestOrder({
      request: new Request("https://test.freightfolio.net/api/internal/test-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ internal_key: INTERNAL_KEY, email }),
      }),
      env: envNoBucket,
    });
    const { body: ob } = await readJson(r);
    const cookie = await createSession(envNoBucket, email, "customer").then((s) => s.cookieValue);
    const fd = new FormData();
    fd.append("order_id", ob.order_id);
    fd.append("file", new Blob([pdfBytes(4)], { type: "application/pdf" }), "doc.pdf");
    const res = await onRequestPost({
      request: new Request("https://test.freightfolio.net/api/upload-direct", {
        method: "POST",
        headers: { cookie: `ff_session=${cookie}` },
        body: fd,
      }),
      env: envNoBucket,
    }).then(readJson);
    assert.equal(res.status, 500);
    assert.equal(res.body.error, "storage_not_configured");
  });
});
