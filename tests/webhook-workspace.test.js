/**
 * webhook workspace routing tests: subscription lifecycle, pilot order +
 * customer record, idempotency. All synthetic, test-mode events.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { routeEvent } from "../functions/api/stripe-webhook.js";
import { getCustomer } from "../lib/customer.js";
import { mockEnv } from "./helpers.js";

const SECRET_ENV = { SESSION_SECRET: "test-session-secret-32bytes-long!!" };

let env;
beforeEach(() => {
  env = mockEnv({ ...SECRET_ENV });
});

function request() {
  return new Request("https://test.freightfolio.net/api/stripe-webhook", { method: "POST" });
}

function pilotEvent(id = "evt_pilot_1") {
  return {
    id,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        mode: "payment",
        amount_total: 999,
        currency: "usd",
        payment_status: "paid",
        customer_details: { email: "pilot@example.com" },
      },
    },
  };
}

function subCheckoutEvent(id = "evt_sub_checkout_1") {
  return {
    id,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        mode: "subscription",
        amount_total: 3900,
        currency: "usd",
        payment_status: "paid",
        customer: "cus_test_123",
        customer_details: { email: "subscriber@example.com" },
      },
    },
  };
}

function subscriptionObject(overrides = {}) {
  return {
    id: "sub_test_1",
    customer: "cus_test_123",
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: "price_starter", unit_amount: 3900 },
          current_period_start: 1790000000,
          current_period_end: 1792592000,
        },
      ],
    },
    ...overrides,
  };
}

describe("checkout.session.completed (pilot)", () => {
  it("creates an order and attaches it to the customer record", async () => {
    const r = await routeEvent(env, pilotEvent(), request());
    assert.equal(r.handled, true);
    assert.equal(r.intake.ok, true);
    assert.equal(r.intake.created, true);
    assert.ok(r.intake.order_id);

    const customer = await getCustomer(env, "pilot@example.com");
    assert.ok(customer);
    assert.ok(customer.orders.includes(r.intake.order_id));
  });

  it("is idempotent: redelivery returns the same order, one customer entry", async () => {
    const r1 = await routeEvent(env, pilotEvent("evt_dup"), request());
    const r2 = await routeEvent(env, pilotEvent("evt_dup"), request());
    assert.equal(r1.intake.created, true);
    assert.equal(r2.intake.created, false);
    assert.equal(r1.intake.order_id, r2.intake.order_id);

    const customer = await getCustomer(env, "pilot@example.com");
    assert.equal(customer.orders.length, 1);
  });

  it("ignores non-pilot one-time checkouts", async () => {
    const ev = pilotEvent("evt_other");
    ev.data.object.amount_total = 5000;
    const r = await routeEvent(env, ev, request());
    assert.equal(r.handled, false);
  });
});

describe("subscription lifecycle", () => {
  it("checkout in subscription mode creates the customer + id mapping", async () => {
    const r = await routeEvent(env, subCheckoutEvent(), request());
    assert.equal(r.handled, true);
    assert.equal(r.intake.kind, "subscription_checkout");
    assert.equal(r.intake.is_new_customer, true);
    assert.equal(r.intake.invite, "skipped_test_mode"); // test events never email

    const customer = await getCustomer(env, "subscriber@example.com");
    assert.ok(customer);
    assert.ok(customer.stripe_customer_ids.includes("cus_test_123"));
  });

  it("subscription.created upserts plan + period from the mapping", async () => {
    await routeEvent(env, subCheckoutEvent(), request());
    const ev = {
      id: "evt_sub_created_1",
      type: "customer.subscription.created",
      livemode: false,
      data: { object: subscriptionObject() },
    };
    const r = await routeEvent(env, ev, request());
    assert.equal(r.handled, true);
    assert.equal(r.intake.kind, "subscription_upsert");

    const customer = await getCustomer(env, "subscriber@example.com");
    assert.equal(customer.subscription.plan, "starter");
    assert.equal(customer.subscription.status, "active");
    assert.equal(customer.subscription.allowance, 100);
    assert.ok(customer.subscription.current_period_end);
  });

  it("invoice.paid refreshes the period and re-activates", async () => {
    await routeEvent(env, subCheckoutEvent("e1"), request());
    await routeEvent(
      env,
      { id: "e2", type: "customer.subscription.created", livemode: false, data: { object: subscriptionObject({ status: "past_due" }) } },
      request()
    );
    const ev = {
      id: "evt_inv_paid_1",
      type: "invoice.paid",
      livemode: false,
      data: {
        object: {
          customer: "cus_test_123",
          customer_email: "subscriber@example.com",
          subscription: "sub_test_1",
          lines: {
            data: [
              {
                price: { id: "price_starter", unit_amount: 3900 },
                period: { start: 1792592000, end: 1795270400 },
              },
            ],
          },
        },
      },
    };
    const r = await routeEvent(env, ev, request());
    assert.equal(r.handled, true);
    const customer = await getCustomer(env, "subscriber@example.com");
    assert.equal(customer.subscription.status, "active");
    assert.equal(customer.subscription.current_period_end, new Date(1795270400 * 1000).toISOString());
  });

  it("invoice.payment_failed marks past_due", async () => {
    await routeEvent(env, subCheckoutEvent("e3"), request());
    await routeEvent(
      env,
      { id: "e4", type: "customer.subscription.created", livemode: false, data: { object: subscriptionObject() } },
      request()
    );
    const ev = {
      id: "evt_inv_fail_1",
      type: "invoice.payment_failed",
      livemode: false,
      data: { object: { customer: "cus_test_123", subscription: "sub_test_1" } },
    };
    const r = await routeEvent(env, ev, request());
    assert.equal(r.handled, true);
    const customer = await getCustomer(env, "subscriber@example.com");
    assert.equal(customer.subscription.status, "past_due");
  });

  it("subscription.deleted marks canceled but keeps history", async () => {
    await routeEvent(env, subCheckoutEvent("e5"), request());
    await routeEvent(
      env,
      { id: "e6", type: "customer.subscription.created", livemode: false, data: { object: subscriptionObject() } },
      request()
    );
    const ev = {
      id: "evt_sub_del_1",
      type: "customer.subscription.deleted",
      livemode: false,
      data: { object: subscriptionObject({ status: "canceled" }) },
    };
    const r = await routeEvent(env, ev, request());
    assert.equal(r.handled, true);
    const customer = await getCustomer(env, "subscriber@example.com");
    assert.equal(customer.subscription.status, "canceled");
    assert.equal(customer.subscription.plan, "starter"); // history kept
  });

  it("subscription events without a resolvable customer are logged, not crashed", async () => {
    const ev = {
      id: "evt_orphan",
      type: "customer.subscription.created",
      livemode: false,
      data: { object: subscriptionObject({ customer: "cus_unknown_xyz" }) },
    };
    const r = await routeEvent(env, ev, request());
    assert.equal(r.handled, true);
    assert.equal(r.intake.ok, false);
    assert.equal(r.intake.error, "no_customer");
  });

  it("unknown event types are left for stripe-watch", async () => {
    const r = await routeEvent(
      env,
      { id: "evt_x", type: "charge.refunded", livemode: false, data: { object: {} } },
      request()
    );
    assert.equal(r.handled, false);
  });
});
