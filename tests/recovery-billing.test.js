/**
 * Recovery add-on ($99/mo) billing core tests.
 * ALL synthetic, livemode:false events. No live Stripe, no real emails.
 *
 * Matrix: add-on checkout -> awaiting_setup (never active); duplicate
 * checkout idempotent; subscription upsert + out-of-order convergence;
 * invoice.payment_failed -> past_due + 7-day grace; invoice.paid during grace
 * -> active; subscription.deleted -> canceled; allowance resets only on
 * period advance; duplicate invoice.paid -> no reset; base-plan changes never
 * touch recovery; pilot $9.99 -> no entitlement; managed_included blocks
 * add-on purchase; internal endpoints guarded + monotonic usage.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { routeEvent } from "../functions/api/stripe-webhook.js";
import {
  getCustomer,
  setRecovery,
  getRecovery,
  recoveryEntitled,
  upsertSubscription,
} from "../lib/customer.js";
import {
  RECOVERY_ADDON,
  isRecoveryAddonPrice,
  entitlementForPriceId,
} from "../lib/recovery-entitlements.js";
import { onRequestGet as eligibilityGet } from "../functions/api/internal/recovery-eligibility.js";
import { onRequestPost as usageSyncPost } from "../functions/api/internal/recovery-usage-sync.js";
import { onRequestPost as adminPost } from "../functions/api/internal/recovery-admin.js";
import { mockEnv, mockRequest } from "./helpers.js";

const SECRET_ENV = { SESSION_SECRET: "test-session-secret-32bytes-long!!" };
const EMAIL = "recovery@example.com";
const CUS = "cus_addon_1";
const SUB = "sub_addon_1";

const T1 = 1790000000; // period A start
const T2 = 1792592000; // period A end / period B start
const T3 = 1795270400; // period B end
const iso = (ts) => new Date(ts * 1000).toISOString();

let env;
beforeEach(() => {
  env = mockEnv({ ...SECRET_ENV });
});

function request() {
  return new Request("https://test.freightfolio.net/api/stripe-webhook", { method: "POST" });
}

function addonCheckoutEvent(id = "evt_addon_checkout_1") {
  return {
    id,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        mode: "subscription",
        amount_total: 9900,
        currency: "usd",
        payment_status: "paid",
        customer: CUS,
        subscription: SUB,
        customer_details: { email: EMAIL },
        line_items: {
          data: [{ price: { id: RECOVERY_ADDON.priceId, unit_amount: 9900 } }],
        },
      },
    },
  };
}

function addonSubscriptionEvent(id, type = "customer.subscription.created", overrides = {}) {
  return {
    id,
    type,
    livemode: false,
    data: {
      object: {
        id: SUB,
        customer: CUS,
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: RECOVERY_ADDON.priceId, unit_amount: 9900 },
              current_period_start: T1,
              current_period_end: T2,
            },
          ],
        },
        ...overrides,
      },
    },
  };
}

function addonInvoicePaidEvent(id, { start = T2, end = T3, proration = false } = {}) {
  return {
    id,
    type: "invoice.paid",
    livemode: false,
    data: {
      object: {
        id: "in_addon_1",
        customer: CUS,
        customer_email: EMAIL,
        subscription: SUB,
        lines: {
          data: [
            {
              price: { id: RECOVERY_ADDON.priceId, unit_amount: 9900 },
              period: { start, end },
              ...(proration ? { proration: true } : {}),
            },
          ],
        },
      },
    },
  };
}

function addonInvoiceFailedEvent(id = "evt_addon_fail_1") {
  return {
    id,
    type: "invoice.payment_failed",
    livemode: false,
    data: { object: { customer: CUS, subscription: SUB } },
  };
}

/** Full setup: checkout + subscription.created -> awaiting_setup entitlement. */
async function provisionAddon() {
  await routeEvent(env, addonCheckoutEvent("e_checkout"), request());
  await routeEvent(env, addonSubscriptionEvent("e_sub_created"), request());
  return getCustomer(env, EMAIL);
}

describe("entitlement config", () => {
  it("recognizes the add-on price id and nothing else", () => {
    assert.equal(isRecoveryAddonPrice(RECOVERY_ADDON.priceId), true);
    assert.equal(isRecoveryAddonPrice("price_starter"), false);
    assert.equal(isRecoveryAddonPrice(null), false);
    assert.equal(entitlementForPriceId(RECOVERY_ADDON.priceId).kind, "recovery_addon");
    assert.equal(entitlementForPriceId("price_whatever").kind, "unknown");
  });
});

describe("add-on checkout", () => {
  it("creates the entitlement as awaiting_setup, NOT active — payment alone never enables chasing", async () => {
    const r = await routeEvent(env, addonCheckoutEvent(), request());
    assert.equal(r.handled, true);
    assert.equal(r.intake.recovery.ok, true);
    assert.equal(r.intake.recovery.status, "awaiting_setup");

    const customer = await getCustomer(env, EMAIL);
    const rec = getRecovery(customer);
    assert.equal(rec.entitlement, "addon");
    assert.equal(rec.status, "awaiting_setup");
    assert.equal(rec.stripe_addon_sub_id, SUB);
    assert.equal(rec.allowance, 50);
    assert.equal(recoveryEntitled(customer), false); // not active, no grace
  });

  it("never creates a base-plan subscription from the 9900-cent add-on price", async () => {
    await routeEvent(env, addonCheckoutEvent(), request());
    await routeEvent(env, addonSubscriptionEvent("e_sc"), request());
    const customer = await getCustomer(env, EMAIL);
    assert.equal(customer.subscription, null); // NOT a "starter" plan
  });

  it("is idempotent: duplicate checkout events converge", async () => {
    const r1 = await routeEvent(env, addonCheckoutEvent("e_dup_a"), request());
    const r2 = await routeEvent(env, addonCheckoutEvent("e_dup_b"), request());
    assert.equal(r1.intake.recovery.ok, true);
    assert.equal(r2.intake.recovery.ok, true);
    assert.equal(r2.intake.recovery.deduped, true);
    const customer = await getCustomer(env, EMAIL);
    assert.equal(getRecovery(customer).status, "awaiting_setup");
  });

  it("defense in depth: upsertSubscription rejects the add-on price id directly", async () => {
    const r = await upsertSubscription(env, {
      email: EMAIL,
      subscription: addonSubscriptionEvent("x").data.object,
      test: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "addon_price_rejected");
  });

  it("managed_included blocks the add-on purchase as a duplicate", async () => {
    await setRecovery(env, EMAIL, { entitlement: "managed_included", status: "active" });
    const r = await routeEvent(env, addonCheckoutEvent(), request());
    assert.equal(r.intake.recovery.ok, false);
    assert.equal(r.intake.recovery.error, "managed_included_duplicate");
    const customer = await getCustomer(env, EMAIL);
    assert.equal(getRecovery(customer).entitlement, "managed_included"); // untouched
  });
});

describe("add-on subscription lifecycle", () => {
  it("subscription.created upserts period bounds, keeps awaiting_setup", async () => {
    await provisionAddon();
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.status, "awaiting_setup");
    assert.equal(rec.billing_period_start, iso(T1));
    assert.equal(rec.billing_period_end, iso(T2));
    assert.equal(rec.addon_price_id, RECOVERY_ADDON.priceId);
  });

  it("out-of-order subscription.updated events converge on the latest period", async () => {
    await provisionAddon();
    // updated with a LATER period arrives first...
    await routeEvent(
      env,
      addonSubscriptionEvent("e_upd_late", "customer.subscription.updated", {
        items: {
          data: [
            {
              price: { id: RECOVERY_ADDON.priceId, unit_amount: 9900 },
              current_period_start: T2,
              current_period_end: T3,
            },
          ],
        },
      }),
      request()
    );
    // ...then the earlier created event is redelivered late.
    await routeEvent(env, addonSubscriptionEvent("e_sub_created_late"), request());
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.billing_period_start, iso(T2));
    assert.equal(rec.billing_period_end, iso(T3));
    assert.equal(rec.status, "awaiting_setup");
  });

  it("a base-plan change never touches the recovery allowance or status", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { requests_used: 12, status: "active" });
    const baseSubEvent = {
      id: "e_base_upd",
      type: "customer.subscription.updated",
      livemode: false,
      data: {
        object: {
          id: "sub_base_1",
          customer: CUS,
          status: "active",
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: "price_business", unit_amount: 14900 },
                current_period_start: T1,
                current_period_end: T2,
              },
            ],
          },
        },
      },
    };
    const r = await routeEvent(env, baseSubEvent, request());
    assert.equal(r.handled, true);
    const customer = await getCustomer(env, EMAIL);
    assert.equal(customer.subscription.plan, "business"); // base side updated
    const rec = getRecovery(customer);
    assert.equal(rec.allowance, 50);
    assert.equal(rec.requests_used, 12);
    assert.equal(rec.status, "active");
  });

  it("cancel_at_period_end keeps service active until the period ends", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active" });
    await routeEvent(
      env,
      addonSubscriptionEvent("e_cancel_sched", "customer.subscription.updated", {
        cancel_at_period_end: true,
      }),
      request()
    );
    const customer = await getCustomer(env, EMAIL);
    const rec = getRecovery(customer);
    assert.equal(rec.status, "active"); // still serving
    assert.equal(rec.cancel_scheduled, true);
    assert.equal(rec.service_end_at, iso(T2));
    assert.equal(recoveryEntitled(customer), true);
  });

  it("subscription.deleted marks canceled", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active" });
    const r = await routeEvent(
      env,
      addonSubscriptionEvent("e_del", "customer.subscription.deleted", { status: "canceled" }),
      request()
    );
    assert.equal(r.handled, true);
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.status, "canceled");
    assert.ok(rec.canceled_at);
    assert.equal(recoveryEntitled({ recovery: rec }), false);
  });
});

describe("add-on invoices: grace, reactivation, allowance reset", () => {
  it("invoice.payment_failed -> past_due + 7-day grace; chasing continues during grace", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active" });
    const r = await routeEvent(env, addonInvoiceFailedEvent(), request());
    assert.equal(r.handled, true);
    const customer = await getCustomer(env, EMAIL);
    const rec = getRecovery(customer);
    assert.equal(rec.status, "past_due");
    const msLeft = new Date(rec.grace_until).getTime() - Date.now();
    assert.ok(msLeft > 6.9 * 24 * 3600 * 1000 && msLeft <= 7 * 24 * 3600 * 1000);
    assert.equal(rec.prior_status, "active");
    assert.equal(recoveryEntitled(customer), true); // grace -> service continues
  });

  it("redelivered payment_failed does not extend the grace window", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active" });
    await routeEvent(env, addonInvoiceFailedEvent("e_fail_1"), request());
    const g1 = getRecovery(await getCustomer(env, EMAIL)).grace_until;
    await routeEvent(env, addonInvoiceFailedEvent("e_fail_2"), request());
    const g2 = getRecovery(await getCustomer(env, EMAIL)).grace_until;
    assert.equal(g1, g2);
  });

  it("invoice.paid during grace restores active", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active" });
    await routeEvent(env, addonInvoiceFailedEvent(), request());
    const r = await routeEvent(env, addonInvoicePaidEvent("e_paid_grace"), request());
    assert.equal(r.handled, true);
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.status, "active");
    assert.equal(rec.grace_until, null);
  });

  it("invoice.paid after past_due from awaiting_setup returns to awaiting_setup", async () => {
    await provisionAddon(); // status awaiting_setup
    await routeEvent(env, addonInvoiceFailedEvent(), request());
    await routeEvent(env, addonInvoicePaidEvent("e_paid_react"), request());
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.status, "awaiting_setup");
  });

  it("invoice.paid advancing the period resets the allowance anchor", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active", requests_used: 30 });
    const r = await routeEvent(
      env,
      addonInvoicePaidEvent("e_paid_adv", { start: T2, end: T3 }),
      request()
    );
    assert.equal(r.intake.recovery.period_advanced, true);
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.requests_used, 0);
    assert.equal(rec.billing_period_start, iso(T2));
  });

  it("duplicate invoice.paid for the same period does NOT reset usage", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active", requests_used: 30 });
    await routeEvent(env, addonInvoicePaidEvent("e_paid_dup1", { start: T1, end: T2 }), request());
    const r = await routeEvent(env, addonInvoicePaidEvent("e_paid_dup2", { start: T1, end: T2 }), request());
    assert.equal(r.intake.recovery.period_advanced, false);
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.requests_used, 30); // untouched
  });

  it("prorated first charge surfaces a proration note", async () => {
    await provisionAddon();
    await routeEvent(env, addonInvoicePaidEvent("e_paid_pro", { proration: true }), request());
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.ok(rec.proration_note && rec.proration_note.includes("mid-cycle"));
  });

  it("base-plan invoice.paid never touches recovery usage", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, { status: "active", requests_used: 17 });
    const baseInvoice = {
      id: "e_base_inv",
      type: "invoice.paid",
      livemode: false,
      data: {
        object: {
          id: "in_base_1",
          customer: CUS,
          customer_email: EMAIL,
          subscription: "sub_base_1",
          lines: {
            data: [
              {
                price: { id: "price_business", unit_amount: 14900 },
                period: { start: T2, end: T3 },
              },
            ],
          },
        },
      },
    };
    await routeEvent(env, baseInvoice, request());
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.requests_used, 17);
    assert.equal(rec.billing_period_start, iso(T1)); // add-on anchor untouched
  });
});

describe("pilot checkout", () => {
  it("$9.99 pilot creates no recovery entitlement", async () => {
    const ev = {
      id: "evt_pilot_rec",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          mode: "payment",
          amount_total: 999,
          currency: "usd",
          payment_status: "paid",
          customer_details: { email: EMAIL },
        },
      },
    };
    await routeEvent(env, ev, request());
    const rec = getRecovery(await getCustomer(env, EMAIL));
    assert.equal(rec.entitlement, "none");
  });
});

describe("internal endpoints", () => {
  const keyHeaders = { headers: { "x-intake-key": "test-only-internal-key" } };

  function eligibilityReq(email, withKey = true) {
    return new Request(
      `https://test.freightfolio.net/api/internal/recovery-eligibility?email=${encodeURIComponent(email)}`,
      withKey ? keyHeaders : {}
    );
  }

  it("eligibility: 401 without the key; reasons explain ineligibility", async () => {
    await provisionAddon();
    const denied = await eligibilityGet({ request: eligibilityReq(EMAIL, false), env });
    assert.equal(denied.status, 401);

    const res = await eligibilityGet({ request: eligibilityReq(EMAIL), env });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.eligible, false);
    assert.ok(body.reasons.includes("authorization_incomplete: authorized_at not set"));
    assert.ok(body.reasons.includes("setup_not_approved"));
    assert.equal(body.entitlement, "addon");
    assert.equal(body.status, "awaiting_setup");
    assert.equal(body.allowance_remaining, 50);
    // never exposes secrets
    assert.equal(JSON.stringify(body).includes("test-only-internal-key"), false);
  });

  it("eligibility: fully authorized + active -> eligible", async () => {
    await provisionAddon();
    await adminPost({
      request: (() => {
        const req = mockRequest(
          { action: "set_authorization", email: EMAIL, authorized_by: "mike", setup: { approved: true, config_valid: true, contacts_approved: true } },
          { url: "https://test.freightfolio.net/api/internal/recovery-admin" }
        );
        req.headers.set("x-intake-key", "test-only-internal-key");
        return req;
      })(),
      env,
    });
    const r = await adminPost({
      request: (() => {
        const req = mockRequest({ action: "set_status", email: EMAIL, status: "active" }, { url: "https://test.freightfolio.net/api/internal/recovery-admin" });
        req.headers.set("x-intake-key", "test-only-internal-key");
        return req;
      })(),
      env,
    });
    assert.equal((await r.json()).ok, true);

    const res = await eligibilityGet({ request: eligibilityReq(EMAIL), env });
    const body = await res.json();
    assert.equal(body.eligible, true);
    assert.deepEqual(body.reasons, []);
  });

  it("eligibility: expired grace -> paused", async () => {
    await provisionAddon();
    await setRecovery(env, EMAIL, {
      status: "past_due",
      grace_until: new Date(Date.now() - 1000).toISOString(),
      prior_status: "active",
    });
    const res = await eligibilityGet({ request: eligibilityReq(EMAIL), env });
    const body = await res.json();
    assert.equal(body.status, "paused");
    assert.equal(body.eligible, false);
  });

  it("usage-sync: 401 without key; monotonic counters; idempotent", async () => {
    await provisionAddon();
    const denied = await usageSyncPost({
      request: mockRequest({ email: EMAIL, requests_used: 5 }, { url: "https://x/" }),
      env,
    });
    assert.equal(denied.status, 401);

    const post = (b) => {
      const req = mockRequest(b, { url: "https://test.freightfolio.net/api/internal/recovery-usage-sync" });
      req.headers.set("x-intake-key", "test-only-internal-key");
      return usageSyncPost({ request: req, env });
    };

    let body = await (await post({ email: EMAIL, requests_used: 30, overage_units: 1 })).json();
    assert.equal(body.ok, true);
    assert.equal(body.requests_used, 30);
    assert.equal(body.allowance_remaining, 20);
    assert.equal(body.overage_units, undefined); // overage is gone: ignored, never stored

    // lower push never decreases
    body = await (await post({ email: EMAIL, requests_used: 20, overage_units: 0 })).json();
    assert.equal(body.requests_used, 30);
    assert.equal(body.clamped, true);

    // unknown customer -> 404; customer without entitlement -> 409
    body = await (await post({ email: "nobody@example.com", requests_used: 1 })).json();
    assert.equal(body.ok, false);
  });

  it("usage-sync: period advance resets the baseline", async () => {
    await provisionAddon();
    const post = (b) => {
      const req = mockRequest(b, { url: "https://test.freightfolio.net/api/internal/recovery-usage-sync" });
      req.headers.set("x-intake-key", "test-only-internal-key");
      return usageSyncPost({ request: req, env });
    };
    await (await post({ email: EMAIL, requests_used: 40 })).json();
    const body = await (
      await post({ email: EMAIL, period_start: T2, requests_used: 3 })
    ).json();
    assert.equal(body.period_advanced, true);
    assert.equal(body.requests_used, 3);
  });

  it("admin: set_managed / clear_managed with audit logging", async () => {
    const call = async (b, withKey = true) => {
      const req = mockRequest(b, { url: "https://test.freightfolio.net/api/internal/recovery-admin" });
      if (withKey) req.headers.set("x-intake-key", "test-only-internal-key");
      return adminPost({ request: req, env });
    };

    assert.equal((await call({ action: "set_managed", email: EMAIL }, false)).status, 401);

    let body = await (await call({ action: "set_managed", email: EMAIL, actor: "ops-test" })).json();
    assert.equal(body.ok, true);
    assert.equal(body.entitlement, "managed_included");
    assert.equal(body.status, "active");
    assert.equal(body.audit, "logged");
    assert.equal(recoveryEntitled(await getCustomer(env, EMAIL)), true);

    const listed = await env.ORDER_KV.list({ prefix: "recovery_audit:" });
    assert.ok(listed.keys.length >= 1);
    const entry = JSON.parse(await env.ORDER_KV.get(listed.keys[0].name));
    assert.equal(entry.action, "set_managed");
    assert.equal(entry.email, EMAIL);

    body = await (await call({ action: "clear_managed", email: EMAIL })).json();
    assert.equal(body.ok, true);
    assert.equal(body.entitlement, "none");

    body = await (await call({ action: "bogus", email: EMAIL })).json();
    assert.equal(body.ok, false);
  });
});
