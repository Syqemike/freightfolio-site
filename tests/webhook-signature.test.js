/**
 * Webhook signature tests: accept / reject / tampered body / expired timestamp.
 * Uses the exported verifySignature from functions/api/stripe-webhook.js.
 * Synthetic payloads only; never hits Stripe.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature } from "../functions/api/stripe-webhook.js";

const SECRET = "whsec_test_only_12345";

function stripeHeader(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex");
  return `t=${t},v1=${sig}`;
}

const PAYLOAD = JSON.stringify({
  id: "evt_test_123",
  type: "checkout.session.completed",
  data: { object: { amount_total: 999, currency: "usd", payment_status: "paid" } },
});

describe("stripe webhook signature verification", () => {
  it("accepts a correctly signed payload", async () => {
    const ok = await verifySignature(PAYLOAD, stripeHeader(PAYLOAD, SECRET), SECRET);
    assert.equal(ok, true);
  });

  it("rejects a wrong secret", async () => {
    const ok = await verifySignature(PAYLOAD, stripeHeader(PAYLOAD, SECRET), "whsec_wrong");
    assert.equal(ok, false);
  });

  it("rejects a tampered body", async () => {
    const tampered = PAYLOAD.replace("999", "9999");
    const ok = await verifySignature(tampered, stripeHeader(PAYLOAD, SECRET), SECRET);
    assert.equal(ok, false);
  });

  it("rejects a tampered signature", async () => {
    const header = stripeHeader(PAYLOAD, SECRET);
    const bad = header.replace(/v1=./, "v1=x");
    const ok = await verifySignature(PAYLOAD, bad, SECRET);
    assert.equal(ok, false);
  });

  it("rejects an expired timestamp (older than 5 minutes)", async () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    const ok = await verifySignature(PAYLOAD, stripeHeader(PAYLOAD, SECRET, old), SECRET);
    assert.equal(ok, false);
  });

  it("rejects a future timestamp beyond tolerance", async () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const ok = await verifySignature(PAYLOAD, stripeHeader(PAYLOAD, SECRET, future), SECRET);
    assert.equal(ok, false);
  });

  it("accepts a timestamp just inside tolerance", async () => {
    const recent = Math.floor(Date.now() / 1000) - 240;
    const ok = await verifySignature(PAYLOAD, stripeHeader(PAYLOAD, SECRET, recent), SECRET);
    assert.equal(ok, true);
  });

  it("rejects missing or malformed headers", async () => {
    assert.equal(await verifySignature(PAYLOAD, null, SECRET), false);
    assert.equal(await verifySignature(PAYLOAD, "garbage", SECRET), false);
    assert.equal(await verifySignature(PAYLOAD, "t=abc,v1=zzz", SECRET), false);
    assert.equal(await verifySignature(PAYLOAD, stripeHeader(PAYLOAD, SECRET), null), false);
  });
});
