/**
 * session tests: magic-link tokens, session cookies, rate limiter,
 * constant-time key comparison. All synthetic.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createMagicToken,
  verifyMagicToken,
  createSession,
  getSession,
  destroySession,
  checkRateLimit,
  checkInternalKey,
  normalizeEmail,
  validEmail,
  ADMIN_EMAIL,
} from "../lib/session.js";
import { mockEnv } from "./helpers.js";

const SECRET = "test-session-secret-32bytes-long!!";

function envWithSecret() {
  return mockEnv({ SESSION_SECRET: SECRET });
}

function cookieRequest(cookieValue, ip = "1.2.3.4") {
  return new Request("https://test.freightfolio.net/api/me", {
    headers: { cookie: `ff_session=${cookieValue}`, "cf-connecting-ip": ip },
  });
}

describe("magic-link tokens", () => {
  let env;
  beforeEach(() => { env = envWithSecret(); });

  it("creates and verifies a token, then burns it (single-use)", async () => {
    const token = await createMagicToken(env, "broker@example.com");
    assert.match(token, /^[0-9a-f]{64}$/);
    const v1 = await verifyMagicToken(env, token);
    assert.equal(v1.ok, true);
    assert.equal(v1.email, "broker@example.com");
    const v2 = await verifyMagicToken(env, token);
    assert.equal(v2.ok, false);
    assert.equal(v2.reason, "already_used");
  });

  it("normalizes email case on create", async () => {
    const token = await createMagicToken(env, "Broker@Example.COM");
    const v = await verifyMagicToken(env, token);
    assert.equal(v.email, "broker@example.com");
  });

  it("rejects malformed tokens", async () => {
    for (const bad of ["", "xyz", "0".repeat(63), "0".repeat(65), null, 42]) {
      const v = await verifyMagicToken(env, bad);
      assert.equal(v.ok, false, JSON.stringify(bad));
    }
  });

  it("rejects an expired token", async () => {
    const token = await createMagicToken(env, "a@b.com");
    // Backdate the stored expiry to the past (field is `exp`).
    const raw = await env.ORDER_KV.get(`magic:${token}`);
    const rec = JSON.parse(raw);
    rec.exp = Date.now() - 1000;
    await env.ORDER_KV.put(`magic:${token}`, JSON.stringify(rec));
    const v = await verifyMagicToken(env, token);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "expired");
  });
});

describe("session cookies", () => {
  let env;
  beforeEach(() => { env = envWithSecret(); });

  it("round-trips a session through the signed cookie", async () => {
    const s = await createSession(env, "broker@example.com", "customer");
    const got = await getSession(cookieRequest(s.cookieValue), env);
    assert.ok(got);
    assert.equal(got.email, "broker@example.com");
    assert.equal(got.role, "customer");
  });

  it("rejects a forged cookie (bad signature)", async () => {
    const s = await createSession(env, "broker@example.com", "customer");
    const forged = s.cookieValue.replace(/.[0-9a-f]{64}$/, "0".repeat(64));
    assert.notEqual(forged, s.cookieValue);
    const got = await getSession(cookieRequest(forged), env);
    assert.equal(got, null);
  });

  it("rejects a cookie for a destroyed session", async () => {
    const s = await createSession(env, "broker@example.com", "customer");
    await destroySession(env, s.sessionId);
    const got = await getSession(cookieRequest(s.cookieValue), env);
    assert.equal(got, null);
  });

  it("rejects a tampered session id", async () => {
    const s = await createSession(env, "broker@example.com", "customer");
    const tampered = "ff_" + "ab".repeat(16) + "." + s.cookieValue.split(".")[1];
    const got = await getSession(cookieRequest(tampered), env);
    assert.equal(got, null);
  });

  it("returns null with no cookie and without SESSION_SECRET", async () => {
    const noCookie = await getSession(new Request("https://x/"), env);
    assert.equal(noCookie, null);
    const noSecret = await getSession(cookieRequest("a.b"), mockEnv());
    assert.equal(noSecret, null);
  });

  it("grants the admin role only via the verify endpoint's email check", async () => {
    // createSession itself trusts its caller; role comes from ADMIN_EMAIL comparison.
    assert.equal(ADMIN_EMAIL, "freightfolio.ops@gmail.com");
    const s = await createSession(env, ADMIN_EMAIL, "admin");
    const got = await getSession(cookieRequest(s.cookieValue), env);
    assert.equal(got.role, "admin");
  });
});

describe("rate limiter", () => {
  let env;
  beforeEach(() => { env = envWithSecret(); });

  it("allows up to the limit then blocks with retry-after", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(env, "test", "key1", 5);
      assert.equal(r.ok, true, "attempt " + i);
    }
    const blocked = await checkRateLimit(env, "test", "key1", 5);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 3600);
  });

  it("tracks keys independently", async () => {
    await checkRateLimit(env, "test", "keyA", 1);
    const other = await checkRateLimit(env, "test", "keyB", 1);
    assert.equal(other.ok, true);
  });
});

describe("checkInternalKey", () => {
  const env = () => mockEnv(); // INTAKE_INTERNAL_KEY = "test-only-internal-key"

  it("accepts the key from body or header", () => {
    assert.equal(checkInternalKey("test-only-internal-key", null, env()), true);
    assert.equal(checkInternalKey(null, "test-only-internal-key", env()), true);
  });

  it("rejects wrong keys and missing env", () => {
    assert.equal(checkInternalKey("wrong", null, env()), false);
    assert.equal(checkInternalKey(null, null, env()), false);
    assert.equal(checkInternalKey("test-only-internal-key", null, {}), false);
  });
});

describe("email helpers", () => {
  it("normalizes and validates", () => {
    assert.equal(normalizeEmail("  ALI@Example.COM "), "ali@example.com");
    assert.equal(validEmail("a@b.com"), true);
    assert.equal(validEmail("not-an-email"), false);
    assert.equal(validEmail(""), false);
  });
});
