/**
 * Password login + password-setup (bootstrap) flow tests.
 * Audit 2026-10-12: WS-01 (login set ff_session=undefined), W-04 (deadlock
 * when the magic-link email never arrives). All synthetic; Resend stubbed.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as authLogin } from "../functions/api/auth/login.js";
import { onRequestPost as setupLink } from "../functions/api/auth/setup-link.js";
import { onRequestPost as setPasswordToken } from "../functions/api/auth/set-password-token.js";
import { onRequestPost as internalTestOrder } from "../functions/api/internal/test-order.js";
import { onRequestGet as getMe } from "../functions/api/me.js";
import { getCustomer, putCustomer, newCustomerRecord } from "../lib/customer.js";
import { hashPassword } from "../lib/password.js";
import { createPasswordSetupToken, getSession } from "../lib/session.js";
import { mockEnv } from "./helpers.js";

const BASE_ENV = {
  SESSION_SECRET: "test-session-secret-32bytes-long!!",
  RESEND_API_KEY: "re_test_key",
};
const INTERNAL_KEY = "test-only-internal-key";

let env;
let realFetch;
let sentEmails;

function stubFetch() {
  realFetch = globalThis.fetch;
  sentEmails = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("api.resend.com")) {
      try {
        sentEmails.push(JSON.parse(opts.body));
      } catch { /* ignore */ }
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

async function readJson(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, body, headers };
}

async function makeCustomerWithOrder(email) {
  const r = await internalTestOrder({
    request: post({ internal_key: INTERNAL_KEY, email }),
    env,
  });
  const { body } = await readJson(r);
  assert.equal(body.ok, true);
  return body.order_id;
}

async function setCustomerPassword(email, password) {
  const customer = await getCustomer(env, email);
  const { hash, salt } = await hashPassword(password);
  customer.password_hash = hash;
  customer.password_salt = salt;
  await putCustomer(env, customer);
}

function cookieValueFrom(res) {
  const setCookie = res.headers["set-cookie"] || "";
  const m = setCookie.match(/ff_session=([^;]+)/);
  return m ? m[1] : null;
}

beforeEach(() => {
  env = mockEnv({ ...BASE_ENV });
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("password login (WS-01)", () => {
  it("sets a valid, working session cookie on correct credentials", async () => {
    await makeCustomerWithOrder("pwlogin@example.com");
    await setCustomerPassword("pwlogin@example.com", "correct-horse-1");

    const { status, body, headers } = await readJson(
      await authLogin({ request: post({ email: "pwlogin@example.com", password: "correct-horse-1" }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const cv = cookieValueFrom({ headers });
    assert.ok(cv, "expected ff_session cookie");
    assert.ok(!cv.includes("undefined"), "cookie must not be ff_session=undefined (WS-01)");
    assert.ok(cv.includes("."), "cookie must carry the HMAC signature");

    // The cookie must actually authenticate a workspace call.
    const me = await readJson(await getMe({
      request: new Request("https://test.freightfolio.net/api/me", {
        headers: { cookie: `ff_session=${cv}` },
      }),
      env,
    }));
    assert.equal(me.status, 200);
    assert.equal(me.body.ok, true);
  });

  it("rejects a wrong password without leaking which part failed", async () => {
    await makeCustomerWithOrder("pwlogin2@example.com");
    await setCustomerPassword("pwlogin2@example.com", "correct-horse-1");
    const { status, body } = await readJson(
      await authLogin({ request: post({ email: "pwlogin2@example.com", password: "wrong-pass" }), env })
    );
    assert.equal(status, 401);
    assert.equal(body.error, "invalid_credentials");
  });
});

describe("password-setup bootstrap (W-04)", () => {
  it("setup-link returns generic OK and emails a paid customer", async () => {
    await makeCustomerWithOrder("setup1@example.com");
    const { status, body } = await readJson(
      await setupLink({ request: post({ email: "setup1@example.com" }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(sentEmails.length, 1);
    assert.ok(sentEmails[0].subject.includes("password"));
    assert.ok(sentEmails[0].text.includes("/login?setup="));
  });

  it("setup-link is non-enumerating for unknown emails", async () => {
    const { status, body } = await readJson(
      await setupLink({ request: post({ email: "nobody-here@example.com" }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(sentEmails.length, 0, "no email for unknown address");
  });

  it("set-password-token sets the password and signs the customer in", async () => {
    await makeCustomerWithOrder("setup2@example.com");
    const token = await createPasswordSetupToken(env, "setup2@example.com");

    const { status, body, headers } = await readJson(
      await setPasswordToken({ request: post({ token, password: "new-secure-pw" }), env })
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const cv = cookieValueFrom({ headers });
    assert.ok(cv && !cv.includes("undefined") && cv.includes("."));

    // Password actually stored: login works with it now.
    const login = await readJson(
      await authLogin({ request: post({ email: "setup2@example.com", password: "new-secure-pw" }), env })
    );
    assert.equal(login.status, 200);
    assert.equal(login.body.ok, true);
  });

  it("set-password-token is single-use", async () => {
    await makeCustomerWithOrder("setup3@example.com");
    const token = await createPasswordSetupToken(env, "setup3@example.com");
    const first = await readJson(
      await setPasswordToken({ request: post({ token, password: "first-password-1" }), env })
    );
    assert.equal(first.status, 200);
    const second = await readJson(
      await setPasswordToken({ request: post({ token, password: "second-password-2" }), env })
    );
    assert.equal(second.status, 400);
    assert.equal(second.body.error, "invalid_token");
  });

  it("set-password-token rejects weak passwords before consuming the token", async () => {
    await makeCustomerWithOrder("setup4@example.com");
    const token = await createPasswordSetupToken(env, "setup4@example.com");
    const weak = await readJson(
      await setPasswordToken({ request: post({ token, password: "short" }), env })
    );
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error, "weak_password");
    // Token not consumed: the real attempt still works.
    const good = await readJson(
      await setPasswordToken({ request: post({ token, password: "long-enough-password" }), env })
    );
    assert.equal(good.status, 200);
  });

  it("set-password-token refuses when a password is already set", async () => {
    await makeCustomerWithOrder("setup5@example.com");
    await setCustomerPassword("setup5@example.com", "existing-password-1");
    const token = await createPasswordSetupToken(env, "setup5@example.com");
    const { status, body } = await readJson(
      await setPasswordToken({ request: post({ token, password: "another-new-password" }), env })
    );
    assert.equal(status, 409);
    assert.equal(body.error, "already_set");
  });

  it("malformed tokens are rejected", async () => {
    const { status, body } = await readJson(
      await setPasswordToken({ request: post({ token: "not-a-token", password: "long-enough-password" }), env })
    );
    assert.equal(status, 400);
    assert.equal(body.error, "invalid_token");
  });
});
