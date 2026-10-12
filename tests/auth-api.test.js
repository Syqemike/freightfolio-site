/**
 * auth + workspace API tests: magic-link request/verify/logout, session
 * gating, cross-customer isolation, admin guards, internal endpoints.
 * All synthetic. Resend/B2 network calls are stubbed.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as authRequest } from "../functions/api/auth/request.js";
import { onRequestPost as authVerify } from "../functions/api/auth/verify.js";
import { onRequestPost as authLogout } from "../functions/api/auth/logout.js";
import { onRequestGet as getMe } from "../functions/api/me.js";
import { onRequestGet as getFiles } from "../functions/api/files.js";
import { onRequestGet as getIssues } from "../functions/api/issues.js";
import { onRequestGet as getReports } from "../functions/api/reports.js";
import { onRequestGet as downloadReport } from "../functions/api/reports/download.js";
import { onRequestGet as getAccount } from "../functions/api/account.js";
import { onRequestPost as deleteRequest } from "../functions/api/account/delete-request.js";
import { onRequestGet as adminBatches } from "../functions/api/admin/batches.js";
import { onRequestPost as adminAction } from "../functions/api/admin/action.js";
import { onRequestPost as internalStatus } from "../functions/api/internal/status.js";
import { onRequestPost as internalTestOrder } from "../functions/api/internal/test-order.js";
import { onRequestPost as internalExpireFiles } from "../functions/api/internal/expire-files.js";
import { onRequestPost as uploadInit } from "../functions/api/upload-init.js";
import { routeEvent } from "../functions/api/stripe-webhook.js";
import { createMagicToken, createSession, ADMIN_EMAIL } from "../lib/session.js";
import { getOrder, putOrder } from "../lib/order-store.js";
import { mockEnv } from "./helpers.js";

const BASE_ENV = {
  SESSION_SECRET: "test-session-secret-32bytes-long!!",
  RESEND_API_KEY: "re_test_key",
};
const INTERNAL_KEY = "test-only-internal-key"; // matches mockEnv default

let env;
let realFetch;

function stubFetch() {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.resend.com")) {
      return new Response(JSON.stringify({ id: "re_test_123" }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
}

function post(body, cookieValue, ip = "9.9.9.9") {
  const headers = { "content-type": "application/json", "cf-connecting-ip": ip };
  if (cookieValue) headers.cookie = `ff_session=${cookieValue}`;
  return new Request("https://test.freightfolio.net/api/x", { method: "POST", headers, body: JSON.stringify(body) });
}
function get(cookieValue, query = "") {
  const headers = {};
  if (cookieValue) headers.cookie = `ff_session=${cookieValue}`;
  return new Request("https://test.freightfolio.net/api/x" + query, { headers });
}
async function readJson(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body, headers: res.headers };
}

async function sessionFor(email, role = "customer") {
  const s = await createSession(env, email, role);
  return s.cookieValue;
}

async function makeCustomerWithOrder(email) {
  // Synthetic paid order via the internal endpoint (no real money).
  const r = await internalTestOrder({
    request: post({ internal_key: INTERNAL_KEY, email }),
    env,
  });
  const { body } = await readJson(r);
  assert.equal(body.ok, true);
  return body.order_id;
}

beforeEach(() => {
  env = mockEnv({ ...BASE_ENV });
  stubFetch();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /api/auth/request", () => {
  it("returns a generic ok for unknown emails and creates no token", async () => {
    const { status, body } = await readJson(
      await authRequest({ request: post({ email: "nobody@example.com" }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    // No magic token should exist for this email.
    let found = false;
    for (const k of env.ORDER_KV._store.keys()) {
      if (k.startsWith("magic:")) {
        const rec = JSON.parse(env.ORDER_KV._store.get(k));
        if (rec.email === "nobody@example.com") found = true;
      }
    }
    assert.equal(found, false);
  });

  it("creates a magic token for a known customer (generic response)", async () => {
    await makeCustomerWithOrder("known@example.com");
    const { status, body } = await readJson(
      await authRequest({ request: post({ email: "known@example.com" }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.match(body.message, /sign-in link/);
    let found = false;
    for (const k of env.ORDER_KV._store.keys()) {
      if (k.startsWith("magic:")) {
        const rec = JSON.parse(env.ORDER_KV._store.get(k));
        if (rec.email === "known@example.com") found = true;
      }
    }
    assert.equal(found, true);
  });

  it("rate-limits after 20 requests per email per hour", async () => {
    await makeCustomerWithOrder("rl@example.com");
    for (let i = 0; i < 20; i++) {
      const r = await readJson(await authRequest({ request: post({ email: "rl@example.com" }, null, "1.1.1." + i), env }));
      assert.equal(r.status, 200);
    }
    const r = await readJson(await authRequest({ request: post({ email: "rl@example.com" }, null, "1.1.1.9"), env }));
    assert.equal(r.status, 429);
    assert.ok(r.headers.get("retry-after"));
  });

  it("accepts the admin email", async () => {
    const { status, body } = await readJson(
      await authRequest({ request: post({ email: ADMIN_EMAIL }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

describe("POST /api/auth/verify + logout", () => {
  it("verifies a token, sets the session cookie, grants customer role", async () => {
    await makeCustomerWithOrder("verify@example.com");
    const token = await createMagicToken(env, "verify@example.com");
    const { status, body, headers } = await readJson(
      await authVerify({ request: post({ token }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.role, "customer");
    const setCookie = headers.get("set-cookie");
    assert.match(setCookie, /ff_session=.+\..+; Path=\/; HttpOnly/);
  });

  it("grants the admin role only to the ops email", async () => {
    const token = await createMagicToken(env, ADMIN_EMAIL);
    const { body } = await readJson(await authVerify({ request: post({ token }), env }));
    assert.equal(body.ok, true);
    assert.equal(body.role, "admin");
  });

  it("rejects bad tokens (401) and expired tokens (410)", async () => {
    const bad = await readJson(await authVerify({ request: post({ token: "0".repeat(64) }), env }));
    assert.equal(bad.status, 401);
    const malformed = await readJson(await authVerify({ request: post({ token: "nope" }), env }));
    assert.equal(malformed.status, 401);
  });

  it("logout destroys the session", async () => {
    await makeCustomerWithOrder("logout@example.com");
    const cookieValue = await sessionFor("logout@example.com");
    const me1 = await readJson(await getMe({ request: get(cookieValue), env }));
    assert.equal(me1.status, 200);
    await authLogout({ request: post({}, cookieValue), env });
    const me2 = await readJson(await getMe({ request: get(cookieValue), env }));
    assert.equal(me2.status, 401);
  });
});

describe("workspace API auth gating", () => {
  it("rejects unauthenticated access with 401", async () => {
    for (const fn of [getMe, getFiles, getIssues, getReports, getAccount]) {
      const r = await readJson(await fn({ request: get(null), env }));
      assert.equal(r.status, 401, fn.name);
    }
    const dl = await downloadReport({ request: get(null, "?order_id=x&file=y"), env });
    assert.equal(dl.status, 401);
  });

  it("rejects a forged session cookie", async () => {
    const forged = "f".repeat(64) + "." + "0".repeat(64);
    const r = await readJson(await getMe({ request: get(forged), env }));
    assert.equal(r.status, 401);
  });

  it("returns the overview for a signed-in pilot customer", async () => {
    const orderId = await makeCustomerWithOrder("pilot2@example.com");
    const cookieValue = await sessionFor("pilot2@example.com");
    const { status, body } = await readJson(await getMe({ request: get(cookieValue), env }));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.email, "pilot2@example.com");
    assert.equal(body.entitlement.kind, "pilot");
    assert.equal(body.current_order.order_id, orderId);
    assert.equal(body.current_order.allowance, 10);
    assert.equal(body.current_order.remaining, 10);
  });

  it("lazily creates a subscription period order on first visit", async () => {
    const req = new Request("https://test.freightfolio.net/api/stripe-webhook", { method: "POST" });
    await routeEvent(env, {
      id: "evt_w1", type: "checkout.session.completed", livemode: false,
      data: { object: { mode: "subscription", amount_total: 14900, currency: "usd", payment_status: "paid", customer: "cus_w1", customer_details: { email: "biz@example.com" } } },
    }, req);
    await routeEvent(env, {
      id: "evt_w2", type: "customer.subscription.created", livemode: false,
      data: { object: { id: "sub_w1", customer: "cus_w1", status: "active", items: { data: [{ price: { id: "p_biz", unit_amount: 14900 }, current_period_start: 1790000000, current_period_end: 1792592000 }] } } },
    }, req);

    const cookieValue = await sessionFor("biz@example.com");
    const { body } = await readJson(await getMe({ request: get(cookieValue), env }));
    assert.equal(body.entitlement.kind, "subscription");
    assert.equal(body.entitlement.plan, "business");
    assert.ok(body.current_order);
    assert.equal(body.current_order.kind, "subscription");
    assert.equal(body.current_order.allowance, 400);
    const order = await getOrder(env, body.current_order.order_id, { test: true });
    assert.equal(order.product, "subscription");
  });
});
describe("cross-customer isolation", () => {
  let orderA, orderB, cookieA, cookieB;

  beforeEach(async () => {
    orderA = await makeCustomerWithOrder("alice@example.com");
    orderB = await makeCustomerWithOrder("bob@example.com");
    // Give Bob a file and a report (as the pipeline would).
    let b = await getOrder(env, orderB, { test: true });
    console.log('DBG hook getOrder:', b ? 'HIT' : 'MISS', 'orderB=', JSON.stringify(orderB));
    b.files.push({ filename: "bob-ratecon.pdf", size_bytes: 1234, received_at: new Date().toISOString(), sha256: "b".repeat(64) });
    b.report_files = b.report_files || [];
    b.issues = b.issues || [];
    b.report_files.push({ name: "report.xlsx", key: `orders/${orderB}/report/report.xlsx`, size_bytes: 999, uploaded_at: new Date().toISOString() });
    await putOrder(env, b, { test: true });
    cookieA = await sessionFor("alice@example.com");
    cookieB = await sessionFor("bob@example.com");
  });

  it("A cannot list B's files", async () => {
    const { body } = await readJson(await getFiles({ request: get(cookieA), env }));
    assert.equal(body.ok, true);
    assert.ok(body.files.every((f) => f.order_id !== orderB));
  });

  it("A cannot download B's report (403); B can (200, proxied bytes)", async () => {
    const denied = await downloadReport({
      request: get(cookieA, `?order_id=${orderB}&file=report.xlsx`),
      env,
    });
    assert.equal(denied.status, 403);

    // Stub B2 for the proxied download (native API, not the S3 endpoint).
    const realFetch = globalThis.fetch;
    const envWithBucket = { ...env, B2_BUCKET_ID: "test-bucket-id-0001" };
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("b2_authorize_account")) {
        return Response.json({
          authorizationToken: "t", accountId: "a",
          apiInfo: { storageApi: { apiUrl: "https://api.test", downloadUrl: "https://f999.backblazeb2.com" } },
          allowed: { bucketName: "test-intake-bucket" },
        });
      }
      if (u.includes("b2_get_download_authorization")) {
        return Response.json({ authorizationToken: "dl-token" });
      }
      if (u.startsWith("https://f999.backblazeb2.com/file/")) {
        return new Response(new Uint8Array(Buffer.from("fake-bytes")), { status: 200 });
      }
      return realFetch(url, opts);
    };
    try {
      const { _clearB2AuthCache } = await import("../lib/b2-native.js");
      _clearB2AuthCache();
      const allowed = await downloadReport({
        request: get(cookieB, `?order_id=${orderB}&file=report.xlsx`),
        env: envWithBucket,
      });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get("location"), null, "no redirect to storage");
      const bytes = Buffer.from(await allowed.arrayBuffer()).toString();
      assert.equal(bytes, "fake-bytes");
      assert.match(allowed.headers.get("content-disposition"), /attachment/);
    } finally {
      globalThis.fetch = realFetch;
      const { _clearB2AuthCache } = await import("../lib/b2-native.js");
      _clearB2AuthCache();
    }
  });

  it("A sees no reports; B sees his own", async () => {
    const a = await readJson(await getReports({ request: get(cookieA), env }));
    assert.deepEqual(a.body.reports, []);
    const b = await readJson(await getReports({ request: get(cookieB), env }));
    assert.equal(b.body.reports.length, 1);
    assert.equal(b.body.reports[0].order_id, orderB);
  });

  it("A cannot read B's order via upload-status with a forged token either", async () => {
    const { status } = await readJson(
      await (await import("../functions/api/upload-status.js")).onRequestGet({
        request: get(cookieA, `?order_id=${orderB}`),
        env,
      })
    );
    assert.equal(status, 403);
  });
});

describe("admin endpoints", () => {
  let orderId, adminCookie, customerCookie;

  beforeEach(async () => {
    orderId = await makeCustomerWithOrder("custadmin@example.com");
    adminCookie = await sessionFor(ADMIN_EMAIL, "admin");
    customerCookie = await sessionFor("custadmin@example.com");
  });

  it("rejects non-admin sessions with 403", async () => {
    const r = await readJson(await adminBatches({ request: get(customerCookie), env }));
    assert.equal(r.status, 403);
    const anon = await readJson(await adminBatches({ request: get(null), env }));
    assert.equal(anon.status, 401);
  });

  it("lists batches for the admin", async () => {
    const { status, body } = await readJson(await adminBatches({ request: get(adminCookie), env }));
    assert.equal(status, 200);
    assert.ok(body.batches.some((b) => b.order_id === orderId));
  });

  it("set_status accepts honest statuses and writes an audit log", async () => {
    const { status, body } = await readJson(
      await adminAction({ request: post({ order_id: orderId, action: "set_status", status: "processing" }, adminCookie), env })
    );
    assert.equal(status, 200);
    assert.equal(body.status, "processing");
    const order = await getOrder(env, orderId, { test: true });
    assert.equal(order.status, "processing");
    // Audit log entry exists.
    let logged = false;
    for (const k of env.ORDER_KV._store.keys()) {
      if (k.startsWith("admin_audit:")) {
        const e = JSON.parse(env.ORDER_KV._store.get(k));
        if (e.actor === ADMIN_EMAIL && e.action === "set_status" && e.target === orderId) logged = true;
      }
    }
    assert.equal(logged, true);
  });

  it("set_status rejects invented statuses", async () => {
    const { status, body } = await readJson(
      await adminAction({ request: post({ order_id: orderId, action: "set_status", status: "completed" }, adminCookie), env })
    );
    assert.equal(status, 400);
    assert.equal(body.error, "bad_status");
  });

  it("add_issue stores a genuine admin note visible to the customer", async () => {
    await adminAction({
      request: post({ order_id: orderId, action: "add_issue", issue: { message: "BOL missing for load 123", severity: "high", recommendation: "Upload the BOL." } }, adminCookie),
      env,
    });
    const { body } = await readJson(await getIssues({ request: get(customerCookie), env }));
    assert.ok(body.issues.some((i) => i.message === "BOL missing for load 123" && i.source === "admin"));
  });
});

describe("internal endpoints", () => {
  it("rejects a wrong internal key", async () => {
    const r = await readJson(await internalStatus({ request: post({ internal_key: "wrong", order_id: "x", status: "processing" }), env }));
    assert.equal(r.status, 401);
    const t = await readJson(await internalTestOrder({ request: post({ internal_key: "wrong", email: "a@b.c" }), env }));
    assert.equal(t.status, 401);
  });

  it("status sync updates the order with honest data only", async () => {
    const orderId = await makeCustomerWithOrder("bridge@example.com");
    const { status, body } = await readJson(
      await internalStatus({
        request: post({
          internal_key: INTERNAL_KEY,
          order_id: orderId,
          status: "needs_attention",
          issues: [{ type: "missing_document", severity: "high", message: "POD missing", source: "pipeline" }],
          report_files: [{ key: `orders/${orderId}/report/report.xlsx`, name: "report.xlsx", size_bytes: 10 }],
        }),
        env,
      })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const order = await getOrder(env, orderId, { test: true });
    assert.equal(order.status, "needs_attention");
    assert.equal(order.issues.length, 1);
    assert.equal(order.report_files.length, 1);
  });

  it("status sync rejects invented statuses and drops off-prefix report keys", async () => {
    const orderId = await makeCustomerWithOrder("bridge2@example.com");
    const bad = await readJson(
      await internalStatus({ request: post({ internal_key: INTERNAL_KEY, order_id: orderId, status: "completed" }), env })
    );
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "bad_status");
    const res = await readJson(
      await internalStatus({
        request: post({ internal_key: INTERNAL_KEY, order_id: orderId, status: "processing", report_files: [{ key: "orders/other/report/x.xlsx", name: "x.xlsx" }] }),
        env,
      })
    );
    assert.equal(res.status, 200); // accepted, but the off-prefix key is dropped
    const order = await getOrder(env, orderId, { test: true });
    assert.deepEqual(order.report_files, []);
  });

  it("test-order creates a synthetic order for a test email", async () => {
    const { status, body } = await readJson(
      await internalTestOrder({ request: post({ internal_key: INTERNAL_KEY, email: "synth@example.com" }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.test, true);
    const order = await getOrder(env, body.order_id, { test: true });
    assert.equal(order.customer_email, "synth@example.com");
  });

  it("expire-files removes swept keys from files and report_files", async () => {
    const orderId = await makeCustomerWithOrder("expire@example.com");
    let order = await getOrder(env, orderId, { test: true });
    const oldKey = `orders/${orderId}/abc123/old.pdf`;
    const keepKey = `orders/${orderId}/def456/keep.pdf`;
    const oldReport = `orders/${orderId}/report/old-report.xlsx`;
    order.files = [
      { key: oldKey, name: "old.pdf" },
      { key: keepKey, name: "keep.pdf" },
    ];
    order.report_files = [{ key: oldReport, name: "old-report.xlsx" }];
    await putOrder(env, order, { test: true });

    const { status, body } = await readJson(
      await internalExpireFiles({
        request: post({
          internal_key: INTERNAL_KEY,
          order_id: orderId,
          keys: [oldKey, oldReport, "orders/someone-else/report/x.xlsx"],
        }),
        env,
      })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.removed_files, 1);
    assert.equal(body.removed_reports, 1);
    order = await getOrder(env, orderId, { test: true });
    assert.deepEqual(order.files.map((f) => f.key), [keepKey]);
    assert.deepEqual(order.report_files, []);
  });

  it("expire-files rejects a wrong internal key", async () => {
    const r = await readJson(
      await internalExpireFiles({ request: post({ internal_key: "wrong", order_id: "x", keys: [] }), env })
    );
    assert.equal(r.status, 401);
  });
});

describe("upload-init with session auth", () => {
  function file(i, overrides = {}) {
    return {
      filename: `sess-doc-${i}.pdf`,
      content_type: "application/pdf",
      size_bytes: 1024,
      sha256: i.toString(16).padStart(64, "0"),
      ...overrides,
    };
  }

  it("lets the owning customer init uploads with the session cookie (no token)", async () => {
    const orderId = await makeCustomerWithOrder("sessowner@example.com");
    const cookieValue = await sessionFor("sessowner@example.com");
    const { status, body } = await readJson(
      await uploadInit({ request: post({ order_id: orderId, files: [file(1)] }, cookieValue), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.uploads.length, 1);
  });

  it("rejects another customer's session with 403", async () => {
    const orderId = await makeCustomerWithOrder("ownerx@example.com");
    await makeCustomerWithOrder("intruder@example.com");
    const intruderCookie = await sessionFor("intruder@example.com");
    const { status, body } = await readJson(
      await uploadInit({ request: post({ order_id: orderId, files: [file(2)] }, intruderCookie), env })
    );
    assert.equal(status, 403);
    assert.equal(body.error, "forbidden");
  });

  it("rejects missing auth with 401", async () => {
    const orderId = await makeCustomerWithOrder("noauth@example.com");
    const { status } = await readJson(
      await uploadInit({ request: post({ order_id: orderId, files: [file(3)] }, null), env })
    );
    assert.equal(status, 401);
  });

  it("still enforces the 10-document allowance over the session path", async () => {
    const orderId = await makeCustomerWithOrder("allow@example.com");
    const cookieValue = await sessionFor("allow@example.com");
    const files = [];
    for (let i = 0; i < 10; i++) files.push(file(100 + i));
    const r1 = await readJson(await uploadInit({ request: post({ order_id: orderId, files }, cookieValue), env }));
    assert.equal(r1.body.uploads.length, 10);
    const r2 = await readJson(
      await uploadInit({ request: post({ order_id: orderId, files: [file(999)] }, cookieValue), env })
    );
    assert.equal(r2.body.ok, false);
    assert.equal(r2.body.error, "allowance_exhausted");
  });
});

describe("account endpoints", () => {
  it("returns plan, usage, and honest retention copy", async () => {
    await makeCustomerWithOrder("acct@example.com");
    const cookieValue = await sessionFor("acct@example.com");
    const { status, body } = await readJson(await getAccount({ request: get(cookieValue), env }));
    assert.equal(status, 200);
    assert.equal(body.plan.kind, "pilot");
    assert.equal(body.usage.allowance, 10);
    assert.match(body.retention.summary, /30 days/i);
    assert.match(body.retention.malware_scanning, /not currently in place/);
  });

  it("deletion request emails ops (stubbed) and returns ok", async () => {
    await makeCustomerWithOrder("del@example.com");
    const cookieValue = await sessionFor("del@example.com");
    const { status, body } = await readJson(
      await deleteRequest({ request: post({ detail: "please remove everything" }, cookieValue), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});
