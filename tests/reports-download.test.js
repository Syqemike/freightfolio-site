/**
 * reports/download tests: report bytes are PROXIED through the Function
 * (same-origin), never redirected to a backblaze2.com URL.
 * B2 HTTP calls are stubbed. Synthetic only.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/reports/download.js";
import { onRequestPost as internalTestOrder } from "../functions/api/internal/test-order.js";
import { createSession } from "../lib/session.js";
import { getOrder, putOrder } from "../lib/order-store.js";
import { _clearB2AuthCache } from "../lib/b2-native.js";
import { mockEnv, readJson } from "./helpers.js";

const INTERNAL_KEY = "test-only-internal-key";

let env;
let realFetch;
let lastDownloadUrl = null;

function stubB2() {
  realFetch = globalThis.fetch;
  lastDownloadUrl = null;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("b2_authorize_account")) {
      return Response.json({
        authorizationToken: "test-auth-token",
        apiInfo: { storageApi: { apiUrl: "https://api.test", downloadUrl: "https://f999.backblazeb2.com" } },
        accountId: "test-account",
        allowed: { bucketName: "test-intake-bucket" },
      });
    }
    if (u.includes("b2_get_download_authorization")) {
      const body = JSON.parse(opts.body);
      assert.equal(body.bucketId, "test-bucket-id-0001");
      assert.ok(String(body.fileNamePrefix).startsWith("orders/ord_"));
      return Response.json({ authorizationToken: "test-dl-token", fileNamePrefix: body.fileNamePrefix });
    }
    if (u.startsWith("https://f999.backblazeb2.com/file/")) {
      lastDownloadUrl = u;
      assert.ok(u.includes("Authorization=test-dl-token"), "download token attached");
      return new Response(new Uint8Array(Buffer.from("PK fake xlsx bytes")), {
        status: 200,
        headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-length": "17" },
      });
    }
    throw new Error("unexpected fetch: " + u);
  };
}

function unstickB2() {
  globalThis.fetch = realFetch;
  _clearB2AuthCache();
}

beforeEach(() => {
  env = mockEnv({ B2_BUCKET_ID: "test-bucket-id-0001", SESSION_SECRET: "test-session-secret-32bytes-long!!" });
  stubB2();
});

afterEach(() => {
  unstickB2();
});

async function makeOrderWithReport(email) {
  const r = await internalTestOrder({
    request: new Request("https://test.freightfolio.net/api/internal/test-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ internal_key: INTERNAL_KEY, email }),
    }),
    env,
  });
  const { body } = await readJson(r);
  const orderId = body.order_id;
  const order = await getOrder(env, orderId, { test: true });
  order.report_files = [{
    key: `orders/${orderId}/report/billing-readiness-report.xlsx`,
    name: "billing-readiness-report.xlsx",
    size_bytes: 17,
  }];
  await putOrder(env, order, { test: true });
  const cookie = await createSession(env, email, "customer").then((s) => s.cookieValue);
  return { orderId, cookie };
}

describe("reports/download", () => {
  it("proxies report bytes same-origin instead of redirecting to B2", async () => {
    const { orderId, cookie } = await makeOrderWithReport("dl@example.com");
    const res = await onRequestGet({
      request: new Request(
        `https://test.freightfolio.net/api/reports/download?order_id=${orderId}&file=billing-readiness-report.xlsx`,
        { headers: { cookie: `ff_session=${cookie}` } }
      ),
      env,
    });
    assert.equal(res.status, 200);
    assert.ok(lastDownloadUrl, "B2 download URL was fetched server-side");
    assert.ok(lastDownloadUrl.startsWith("https://f999.backblazeb2.com/file/"),
      "uses B2 native download domain, not the S3 endpoint");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(Buffer.from(bytes).toString(), "PK fake xlsx bytes");
    assert.match(res.headers.get("content-disposition"), /attachment/);
    assert.match(res.headers.get("content-disposition"), /billing-readiness-report\.xlsx/);
  });

  it("rejects unknown report names", async () => {
    const { orderId, cookie } = await makeOrderWithReport("dl2@example.com");
    const res = await onRequestGet({
      request: new Request(
        `https://test.freightfolio.net/api/reports/download?order_id=${orderId}&file=nope.xlsx`,
        { headers: { cookie: `ff_session=${cookie}` } }
      ),
      env,
    });
    const { status, body } = await readJson(res);
    assert.equal(status, 404);
    assert.equal(body.error, "unknown_report");
    assert.equal(lastDownloadUrl, null, "B2 was never touched");
  });

  it("requires auth", async () => {
    const { orderId } = await makeOrderWithReport("dl3@example.com");
    const res = await onRequestGet({
      request: new Request(
        `https://test.freightfolio.net/api/reports/download?order_id=${orderId}&file=billing-readiness-report.xlsx`
      ),
      env,
    });
    assert.equal(res.status, 401);
  });
});
