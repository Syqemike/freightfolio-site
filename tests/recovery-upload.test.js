/**
 * Real execution test for GET/POST functions/api/recovery/upload.js.
 *
 * The handler logic is REAL (token HMAC verification, scope/expiry checks,
 * file type + size limits, SHA-256 key layout, sidecar write). Only the
 * Cloudflare/platform surface is stubbed:
 *   - `env` (RECOVERY_UPLOAD_SECRET, B2_* config, ORDER_KV)
 *   - global `fetch` for the B2 native API calls (auth, get_upload_url,
 *     upload POST) — no network is ever touched; uploaded bytes are recorded
 *     in memory and asserted.
 *
 * Tokens are minted in-test using the token format documented in
 * lib/recovery-tokens.js (HMAC-SHA256 over "<scope>.<expUnix>"), which is the
 * same format the VM mint side produces. All fixtures are synthetic.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost } from "../functions/api/recovery/upload.js";
import { mockKv } from "./helpers.js";

const te = new TextEncoder();
const SECRET = "test-only-recovery-upload-secret-00000000";
const ORDER_ID = "ord_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REQUIREMENT_ID = "missing_pod";
const CUSTOMER_ID = "cust_test_001";
const SCOPE = `${CUSTOMER_ID}:${ORDER_ID}:${REQUIREMENT_ID}`;

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintToken(scope, expUnix, secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, te.encode(`${scope}.${expUnix}`))
  );
  return (
    "rcv_" +
    b64url(te.encode(scope)) +
    "." +
    b64url(te.encode(String(expUnix))) +
    "." +
    b64url(sig)
  );
}

function pdfBytes(n = 1024) {
  const b = new Uint8Array(n);
  b.set(te.encode("%PDF-1.7 test"), 0);
  return b;
}
function pngBytes(n = 1024) {
  const b = new Uint8Array(n);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return b;
}
function textBytes(n = 100) {
  const b = new Uint8Array(n);
  b.set(te.encode("hello, this is not an allowed document type"), 0);
  return b;
}

function postRequest(token, bytes, filename = "doc.pdf") {
  const form = new FormData();
  if (bytes) {
    form.append("file", new Blob([bytes], { type: "application/octet-stream" }), filename);
  }
  return new Request(`https://test.freightfolio.net/api/recovery/upload?t=${encodeURIComponent(token)}`, {
    method: "POST",
    body: form,
  });
}

// ---- B2 network stub -------------------------------------------------------
// Records uploads in `uploads`: Map(fileName -> { contentType, bytes, sha256Hex }).
// Fails uploads whose key ends in ".json" when `failJsonSidecar` is true.
const uploads = new Map();
let failJsonSidecar = false;
const UPLOAD_URL = "https://upload.stub.b2/";

const realFetch = globalThis.fetch;
beforeEach(() => {
  uploads.clear();
  failJsonSidecar = false;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u === "https://api.backblazeb2.com/b2api/v3/b2_authorize_account") {
      return new Response(
        JSON.stringify({
          accountId: "stub-acct",
          authorizationToken: "stub-auth",
          allowed: { bucketName: "Freightfolio-uploads" },
          apiInfo: { storageApi: { apiUrl: "https://api.stub.b2", downloadUrl: "https://d.stub.b2" } },
        }),
        { status: 200 }
      );
    }
    if (u === "https://api.stub.b2/b2api/v3/b2_get_upload_url") {
      return new Response(
        JSON.stringify({ uploadUrl: UPLOAD_URL, authorizationToken: "stub-upload" }),
        { status: 200 }
      );
    }
    if (u === UPLOAD_URL) {
      const headers = new Headers(opts.headers || {});
      const fileName = decodeURIComponent(headers.get("X-Bz-File-Name") || "");
      if (failJsonSidecar && fileName.endsWith(".json")) {
        return new Response(JSON.stringify({ code: "stub_failure" }), { status: 500 });
      }
      const raw = new Uint8Array(await new Response(opts.body).arrayBuffer());
      uploads.set(fileName, {
        contentType: headers.get("Content-Type"),
        bytes: raw,
        sha256Hex: headers.get("X-Bz-Content-Sha256"),
      });
      return new Response(JSON.stringify({ fileId: "stub-file", fileName }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function testEnv(overrides = {}) {
  return {
    ORDER_KV: mockKv(),
    RECOVERY_UPLOAD_SECRET: SECRET,
    B2_KEY_ID: "testKeyId0000000000001",
    B2_KEY_SECRET: "test-only-b2-secret-not-real",
    B2_BUCKET_ID: "stub-bucket-id",
    ...overrides,
  };
}

async function post(token, env, bytes, filename) {
  const res = await onRequestPost({ request: postRequest(token, bytes, filename), env });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const nowSec = () => Math.floor(Date.now() / 1000);

test("POST valid token + PDF: 200, correct key layout, sidecar recorded", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const env = testEnv();
  const bytes = pdfBytes(2048);
  const { status, body } = await post(token, env, bytes, "rate-confirmation.pdf");

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.order_id, ORDER_ID);
  assert.equal(body.requirement_id, REQUIREMENT_ID);
  assert.equal(body.filename, "rate-confirmation.pdf");
  assert.equal(body.detected_type, "pdf");
  assert.equal(body.association_recorded, true);
  assert.match(body.key, new RegExp(`^orders/${ORDER_ID}/[0-9a-f]{64}/rate-confirmation\\.pdf$`));
  assert.equal(body.key, `orders/${ORDER_ID}/${body.sha256}/rate-confirmation.pdf`);

  // Primary document upload recorded at the SHA-256-keyed layout.
  const primary = uploads.get(body.key);
  assert.ok(primary, "primary file upload recorded");
  assert.equal(primary.contentType, "application/pdf");
  assert.deepEqual(primary.bytes, bytes);

  // Token->request sidecar persisted at the documented association path.
  const expectedSidecar = `orders/${ORDER_ID}/recovery/${REQUIREMENT_ID}/${body.sha256}.json`;
  assert.equal(body.association_key, expectedSidecar);
  const sidecar = uploads.get(expectedSidecar);
  assert.ok(sidecar, "sidecar write recorded");
  assert.equal(sidecar.contentType, "application/json");
  const assoc = JSON.parse(new TextDecoder().decode(sidecar.bytes));
  assert.equal(assoc.token, token, "sidecar stores the exact presented token");
  assert.equal(assoc.order_id, ORDER_ID);
  assert.equal(assoc.requirement_id, REQUIREMENT_ID);
  assert.equal(assoc.customer_id, CUSTOMER_ID);
  assert.equal(assoc.key, body.key);
  assert.equal(assoc.sha256, body.sha256);
  assert.equal(assoc.filename, "rate-confirmation.pdf");
});

test("POST expired token: 410", async () => {
  const token = await mintToken(SCOPE, nowSec() - 10);
  const { status, body } = await post(token, testEnv(), pdfBytes());
  assert.equal(status, 410);
  assert.equal(body.ok, false);
  assert.equal(body.error, "expired");
  assert.equal(uploads.size, 0, "no upload attempted");
});

test("POST forged token (bad signature): 401", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600, "attacker-secret-000000000000000000");
  const { status, body } = await post(token, testEnv(), pdfBytes());
  assert.equal(status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, "bad_signature");
});

test("POST malformed token: 400", async () => {
  const { status, body } = await post("not-a-token", testEnv(), pdfBytes());
  assert.equal(status, 400);
  assert.equal(body.error, "malformed");
});

test("POST missing token param: 400", async () => {
  const res = await onRequestPost({
    request: new Request("https://test.freightfolio.net/api/recovery/upload", { method: "POST" }),
    env: testEnv(),
  });
  assert.equal(res.status, 400);
});

test("POST oversized file: 400 too_large", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const big = pdfBytes(26 * 1024 * 1024); // 26 MB > 25 MB ceiling
  const { status, body } = await post(token, testEnv(), big);
  assert.equal(status, 400);
  assert.equal(body.error, "too_large");
  assert.equal(uploads.size, 0, "oversized file never uploaded");
});

test("POST disallowed file type (text magic bytes): 400 bad_file_type", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const { status, body } = await post(token, testEnv(), textBytes(), "notes.pdf");
  assert.equal(status, 400);
  assert.equal(body.error, "bad_file_type", "extension ignored, content rejected");
  assert.equal(uploads.size, 0);
});

test("POST PNG is accepted and MIME is image/png", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const { status, body } = await post(token, testEnv(), pngBytes(), "pod.png");
  assert.equal(status, 200);
  assert.equal(body.detected_type, "png");
  assert.equal(uploads.get(body.key).contentType, "image/png");
});

test("POST missing file field: 400 missing_file", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const { status, body } = await post(token, testEnv(), null);
  assert.equal(status, 400);
  assert.equal(body.error, "missing_file");
});

test("POST without RECOVERY_UPLOAD_SECRET: 500", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const { RECOVERY_UPLOAD_SECRET, ...env } = testEnv();
  const { status, body } = await post(token, env, pdfBytes());
  assert.equal(status, 500);
  assert.equal(body.error, "not_configured");
});

test("sidecar write failure degrades gracefully: file stored, association_recorded=false", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  failJsonSidecar = true;
  const { status, body } = await post(token, testEnv(), pdfBytes());
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.association_recorded, false);
  assert.ok(uploads.get(body.key), "primary document still stored");
  assert.equal(uploads.get(body.association_key), undefined, "sidecar absent");
});

test("rate limit: 21st upload in an hour returns 429", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const env = testEnv();
  let last;
  for (let i = 0; i < 21; i++) {
    last = await post(token, env, pdfBytes(), `file${i}.pdf`);
  }
  assert.equal(last.status, 429);
  assert.equal(last.body.error, "rate_limited");
});

test("GET valid token: 200 HTML upload form", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600);
  const res = await onRequestGet({
    request: new Request(`https://test.freightfolio.net/api/recovery/upload?t=${token}`),
    env: testEnv(),
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /multipart\/form-data/);
  assert.ok(html.includes(`/api/recovery/upload?t=${encodeURIComponent(token)}`));
});

test("GET expired token: 410", async () => {
  const token = await mintToken(SCOPE, nowSec() - 10);
  const res = await onRequestGet({
    request: new Request(`https://test.freightfolio.net/api/recovery/upload?t=${token}`),
    env: testEnv(),
  });
  assert.equal(res.status, 410);
});

test("GET forged token: 400 invalid link page", async () => {
  const token = await mintToken(SCOPE, nowSec() + 3600, "attacker-secret-000000000000000000");
  const res = await onRequestGet({
    request: new Request(`https://test.freightfolio.net/api/recovery/upload?t=${token}`),
    env: testEnv(),
  });
  assert.equal(res.status, 400);
});
