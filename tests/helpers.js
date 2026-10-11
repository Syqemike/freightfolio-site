/**
 * Shared test helpers: in-memory KV mock and synthetic env.
 * ALL data here is synthetic. Nothing touches live Stripe, live KV, or real credentials.
 */
import { test } from "node:test";

export function mockKv() {
  const store = new Map();
  return {
    _store: store,
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v, _opts) {
      store.set(k, v);
    },
    async delete(k) {
      store.delete(k);
    },
    async list({ prefix } = {}) {
      const keys = [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name }));
      return { keys };
    },
  };
}

export function mockEnv(overrides = {}) {
  return {
    ORDER_KV: mockKv(),
    UPLOAD_TOKEN_SECRET: "test-only-upload-secret-0123456789",
    INTAKE_INTERNAL_KEY: "test-only-internal-key",
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_REGION: "us-west-004",
    B2_BUCKET: "test-intake-bucket",
    B2_KEY_ID: "testKeyId0000000000001",
    B2_KEY_SECRET: "testKeySecret0000000000000000000001",
    PUBLIC_ORIGIN: "https://test.freightfolio.net",
    // RESEND_API_KEY intentionally unset: notify tests assert graceful failure.
    ...overrides,
  };
}

export function mockRequest(body, { method = "POST", url = "https://test.freightfolio.net/api/x" } = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

export async function readJson(res) {
  return { status: res.status, body: await res.json() };
}
