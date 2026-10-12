/**
 * tests/recovery-addon-integration.test.js — end-to-end integration for the
 * Missing-Document Recovery $99/mo add-on (staging, no Stripe API/network).
 *
 * Matrix (§8 of the integrator brief):
 *   1. add-on purchase on each base plan -> awaiting_setup (never active)
 *   2. onboarding setup submit (REAL setup handler, mock session) -> authorized -> eligible
 *   3. duplicate / delayed / out-of-order webhook events converge
 *   4. payment_failed -> past_due -> grace -> paused
 *   5. cancel -> canceled; re-purchase -> awaiting_setup again
 *   6. allowance resets on period advance only
 *   7. 51st request blocked at $0 cap (REAL Python ledger+gate via child_process)
 *   8. pause + authorization withdrawal stop eligibility
 *   9. managed_included blocks the $99 purchase
 *   10. pilot event never creates entitlement
 *   11. customer A cannot touch customer B's recovery record
 *   12. overage-cap rules (raise / lower / never below incurred)
 *   13. reauth trigger on config change, re-approval clears it
 *   14. /api/me exposes recovery in the shape the workspace tab expects
 *
 * ALL synthetic, livemode:false Stripe events. Mock KV, mock sessions,
 * temp-dir metering state. No live charges, no live emails.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeEvent } from "../functions/api/stripe-webhook.js";
import {
  getCustomer,
  getRecovery,
  setRecovery,
  recoveryEntitled,
} from "../lib/customer.js";
import { RECOVERY_ADDON } from "../lib/recovery-entitlements.js";
import { createSession } from "../lib/session.js";
import { onRequestGet as getMe } from "../functions/api/me.js";
import { onRequestPost as setupPost } from "../functions/api/recovery/setup.js";
import { onRequestPost as pausePost } from "../functions/api/recovery/pause.js";
import { onRequestPost as resumePost } from "../functions/api/recovery/resume.js";
import { onRequestPost as overageCapPost } from "../functions/api/recovery/overage-cap.js";
import { onRequestPost as cancelPost } from "../functions/api/recovery/cancel.js";
import { onRequestGet as adminRecoveryGet } from "../functions/api/admin/recovery.js";
import { onRequestGet as eligibilityGet } from "../functions/api/internal/recovery-eligibility.js";
import { onRequestPost as adminPost } from "../functions/api/internal/recovery-admin.js";
import { mockEnv, mockRequest } from "./helpers.js";

const SECRET_ENV = { SESSION_SECRET: "test-session-secret-32bytes-long!!" };
const INTAKE_KEY = "test-only-internal-key"; // matches mockEnv default
const T1 = 1790000000; // period A start
const T2 = 1792592000; // period A end / period B start
const T3 = 1795270400; // period B end
const iso = (ts) => new Date(ts * 1000).toISOString();

const BASE_PLANS = [
  { key: "starter", price_id: "price_starter_syn", amount: 3900 },
  { key: "business", price_id: "price_business_syn", amount: 14900 },
  { key: "premium", price_id: "price_premium_syn", amount: 36900 },
];

let env;
beforeEach(() => {
  env = mockEnv({ ...SECRET_ENV });
});

function webhookRequest() {
  return new Request("https://test.freightfolio.net/api/stripe-webhook", { method: "POST" });
}

function addonCheckoutEvent(email, cus, sub, id = `evt_co_${cus}`) {
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
        customer: cus,
        subscription: sub,
        customer_details: { email },
        line_items: { data: [{ price: { id: RECOVERY_ADDON.priceId, unit_amount: 9900 } }] },
      },
    },
  };
}

function addonSubEvent(cus, sub, id, type = "customer.subscription.created", overrides = {}) {
  return {
    id,
    type,
    livemode: false,
    data: {
      object: {
        id: sub,
        customer: cus,
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

function baseSubEvent(cus, plan, id, type = "customer.subscription.created") {
  return {
    id,
    type,
    livemode: false,
    data: {
      object: {
        id: `sub_base_${plan.key}_${cus}`,
        customer: cus,
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: plan.price_id, unit_amount: plan.amount },
              current_period_start: T1,
              current_period_end: T2,
            },
          ],
        },
      },
    },
  };
}

function addonInvoiceEvent(cus, sub, id, { start = T1, end = T2, proration = false } = {}) {
  return {
    id,
    type: "invoice.paid",
    livemode: false,
    data: {
      object: {
        id: `in_${id}`,
        customer: cus,
        customer_email: null,
        subscription: sub,
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

function addonPaymentFailed(cus, sub, id = `evt_fail_${cus}`) {
  return {
    id,
    type: "invoice.payment_failed",
    livemode: false,
    data: { object: { customer: cus, subscription: sub } },
  };
}

/** Build a valid onboarding body (mirrors what workspace.js posts). */
function onboardingBody(overrides = {}) {
  const contacts = {
    carrier: { name: "Jane Driver", email: "jane@example.com" },
    dispatcher: { name: "", email: "" },
    shipper: { name: "", email: "" },
    escalation: { name: "", email: "" },
  };
  return {
    permission: true,
    contacts: { ...contacts, ...(overrides.contacts || {}) },
    sender_name: "Acme Brokerage",
    sender_email: "billing@acme.com",
    reply_to: "",
    templates: {
      first_request_subject: "Missing document for load {{load_id}}",
      first_request_body: "Hi, please send the document.",
      reminder_subject: "Reminder: missing {{document_type}}",
      reminder_body: "Following up.",
      escalation_subject: "Escalation: still missing",
      escalation_body: "Third request.",
    },
    cadence: { days_between_attempts: 3, max_attempts: 3, escalate_after_attempts: 2 },
    timezone: "America/Chicago",
    escalation_rule: "Escalate after 2 unanswered attempts.",
    requirements: ["rate_con", "bol", "pod"],
    overage_cap_cents: 0,
    ...overrides,
  };
}

async function sessionFor(email) {
  const { cookieValue } = await createSession(env, email);
  return cookieValue;
}

function authedPost(cookie, body, path = "https://test.freightfolio.net/api/recovery/x") {
  const req = mockRequest(body, { url: path });
  req.headers.set("cookie", `ff_session=${cookie}`);
  return req;
}

async function provisionAddon(email, cus = "cus_int_1", sub = "sub_int_1") {
  await routeEvent(env, addonCheckoutEvent(email, cus, sub), webhookRequest());
  await routeEvent(env, addonSubEvent(cus, sub, "evt_sub_int"), webhookRequest());
  return getCustomer(env, email);
}

async function eligibility(email) {
  const res = await eligibilityGet({
    request: new Request(
      `https://test.freightfolio.net/api/internal/recovery-eligibility?email=${encodeURIComponent(email)}`,
      { headers: { "x-intake-key": INTAKE_KEY } }
    ),
    env,
  });
  return res.json();
}

async function adminAction(body) {
  const req = mockRequest(body, { url: "https://test.freightfolio.net/api/internal/recovery-admin" });
  req.headers.set("x-intake-key", INTAKE_KEY);
  return adminPost({ request: req, env }).then((r) => r.json());
}

describe("1. add-on purchase on each base plan -> awaiting_setup, never active", () => {
  for (const plan of BASE_PLANS) {
    it(`base plan ${plan.key}: add-on coexists, base untouched, recovery never auto-activates`, async () => {
      const email = `buyer-${plan.key}@example.com`;
      const cus = `cus_${plan.key}`;
      const sub = `sub_addon_${plan.key}`;

      await routeEvent(env, addonCheckoutEvent(email, cus, sub), webhookRequest());
      // base subscription AFTER the checkout that maps the Stripe customer id
      await routeEvent(env, baseSubEvent(cus, plan, `evt_base_${plan.key}`), webhookRequest());
      await routeEvent(env, addonSubEvent(cus, sub, `evt_asub_${plan.key}`), webhookRequest());

      const customer = await getCustomer(env, email);
      assert.equal(customer.subscription.plan, plan.key); // base plan intact
      assert.equal(customer.subscription.allowance, { starter: 100, business: 400, premium: 1000 }[plan.key]);
      const rec = getRecovery(customer);
      assert.equal(rec.entitlement, "addon");
      assert.equal(rec.status, "awaiting_setup");
      assert.equal(rec.stripe_addon_sub_id, sub);
      assert.equal(rec.allowance, 50);
      assert.equal(recoveryEntitled(customer), false); // payment alone never enables chasing

      // /api/me reflects the pending add-on for the workspace tab
      const cookie = await sessionFor(email);
      const meRes = await getMe({
        request: new Request("https://test.freightfolio.net/api/me", {
          headers: { cookie: `ff_session=${cookie}` },
        }),
        env,
      });
      const me = await meRes.json();
      assert.equal(me.ok, true);
      assert.equal(me.recovery.entitlement, "addon");
      assert.equal(me.recovery.status, "awaiting_setup");
      assert.equal(me.recovery.allowance, 50);
      assert.equal(me.recovery.requests_remaining, 50);
    });
  }
});

describe("2. onboarding setup submit -> authorized -> eligible", () => {
  it("full path: real setup handler validates, authorizes, activates; eligibility converges", async () => {
    const email = "onboard@example.com";
    await provisionAddon(email);

    // invalid body is rejected server-side (permission not granted)
    const cookie = await sessionFor(email);
    const bad = await setupPost({
      request: authedPost(cookie, onboardingBody({ permission: false }), "https://test.freightfolio.net/api/recovery/setup"),
      env,
    }).then((r) => r.json());
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_setup");
    assert.ok(getRecovery(await getCustomer(env, email)).authorized_at === null);

    // valid submit -> authorized + active
    const good = await setupPost({
      request: authedPost(cookie, onboardingBody(), "https://test.freightfolio.net/api/recovery/setup"),
      env,
    }).then((r) => r.json());
    assert.equal(good.ok, true);
    assert.equal(good.activated, true);
    assert.equal(good.status, "active");
    assert.equal(good.reauth_triggered, false);

    const rec = getRecovery(await getCustomer(env, email));
    assert.ok(rec.authorized_at);
    assert.equal(rec.authorized_by, email);
    assert.equal(rec.setup.approved, true);
    assert.equal(rec.setup.config_valid, true);
    assert.equal(rec.setup.contacts_approved, true);
    assert.equal(recoveryEntitled(await getCustomer(env, email)), true);

    const elig = await eligibility(email);
    assert.equal(elig.eligible, true);
    assert.deepEqual(elig.reasons, []);
    assert.equal(elig.allowance_remaining, 50);
    assert.equal(elig.status, "active");
  });
});

describe("3. duplicate / delayed / out-of-order webhook events converge", () => {
  it("redelivered checkout + reversed subscription updates converge on the latest period", async () => {
    const email = "converge@example.com";
    const cus = "cus_conv";
    const sub = "sub_conv";
    const r = webhookRequest();

    // checkout delivered twice
    await routeEvent(env, addonCheckoutEvent(email, cus, sub, "evt_co_a"), r);
    await routeEvent(env, addonCheckoutEvent(email, cus, sub, "evt_co_b"), r);
    // LATER period arrives first...
    await routeEvent(
      env,
      addonSubEvent(cus, sub, "evt_upd_late", "customer.subscription.updated", {
        items: { data: [{ price: { id: RECOVERY_ADDON.priceId, unit_amount: 9900 }, current_period_start: T2, current_period_end: T3 }] },
      }),
      r
    );
    // ...then the original created event arrives late
    await routeEvent(env, addonSubEvent(cus, sub, "evt_created_late"), r);

    const rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.status, "awaiting_setup");
    assert.equal(rec.billing_period_start, iso(T2));
    assert.equal(rec.billing_period_end, iso(T3));

    // duplicate invoice.paid for the same period never resets usage
    await setRecovery(env, email, { status: "active", requests_used: 30 });
    await routeEvent(env, addonInvoiceEvent(cus, sub, "paid_a", { start: T2, end: T3 }), r);
    await routeEvent(env, addonInvoiceEvent(cus, sub, "paid_b", { start: T2, end: T3 }), r);
    const rec2 = getRecovery(await getCustomer(env, email));
    assert.equal(rec2.requests_used, 30);
  });
});

describe("4. payment_failed -> past_due -> grace -> paused", () => {
  it("grace continues service; expiry pauses; recovery restores", async () => {
    const email = "grace@example.com";
    const cus = "cus_grace";
    const sub = "sub_grace";
    await provisionAddon(email, cus, sub);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });

    await routeEvent(env, addonPaymentFailed(cus, sub), webhookRequest());
    let rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.status, "past_due");
    assert.ok(new Date(rec.grace_until).getTime() - Date.now() > 6.9 * 86400 * 1000);
    assert.equal(recoveryEntitled(await getCustomer(env, email)), true);
    let elig = await eligibility(email);
    assert.equal(elig.eligible, true); // service continues during grace

    // grace expires -> lazy lifecycle pauses
    await setRecovery(env, email, { grace_until: new Date(Date.now() - 1000).toISOString() });
    elig = await eligibility(email);
    assert.equal(elig.status, "paused");
    assert.equal(elig.eligible, false);

    // recovery invoice restores to active
    await routeEvent(env, addonInvoiceEvent(cus, sub, "paid_react", { start: T1, end: T2 }), webhookRequest());
    rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.status, "active");
    assert.equal(rec.grace_until, null);
  });
});

describe("5. cancel -> canceled; re-purchase -> awaiting_setup; customer cancel endpoint", () => {
  it("subscription.deleted cancels; a new subscription re-enters awaiting_setup", async () => {
    const email = "cancel@example.com";
    const cus = "cus_can";
    const sub = "sub_can";
    await provisionAddon(email, cus, sub);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });

    await routeEvent(
      env,
      addonSubEvent(cus, sub, "evt_del", "customer.subscription.deleted", { status: "canceled" }),
      webhookRequest()
    );
    let rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.status, "canceled");
    assert.equal(recoveryEntitled({ recovery: rec }), false);

    // re-purchase (new sub id) lands back in awaiting_setup, not active
    const sub2 = "sub_can_2";
    await routeEvent(env, addonSubEvent(cus, sub2, "evt_rebuy", "customer.subscription.created"), webhookRequest());
    rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.entitlement, "addon");
    assert.equal(rec.status, "awaiting_setup");
    assert.equal(rec.stripe_addon_sub_id, sub2);
  });

  it("customer cancel endpoint schedules cancel at period end (service continues)", async () => {
    const email = "selfcancel@example.com";
    await provisionAddon(email, "cus_sc", "sub_sc");
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });

    const res = await cancelPost({
      request: authedPost(cookie, {}, "https://test.freightfolio.net/api/recovery/cancel"),
      env,
    }).then((r) => r.json());
    assert.equal(res.ok, true);
    assert.equal(res.status, "active"); // still serving through the period
    assert.equal(res.cancel_scheduled, true);
    assert.equal(res.service_end_at, iso(T2));
    assert.ok(res.manual_stripe_action); // honest about the missing server-side key
    assert.equal(recoveryEntitled(await getCustomer(env, email)), true);

    // /api/me shows the scheduled cancel so the tab can render it
    const meRes = await getMe({
      request: new Request("https://test.freightfolio.net/api/me", {
        headers: { cookie: `ff_session=${cookie}` },
      }),
      env,
    });
    const me = await meRes.json();
    assert.equal(me.recovery.cancel_scheduled, true);
    assert.equal(me.recovery.service_end_at, iso(T2));
  });
});

describe("6. allowance resets on period advance only", () => {
  it("same-period invoice.paid keeps usage; next-period resets", async () => {
    const email = "reset@example.com";
    const cus = "cus_rst";
    const sub = "sub_rst";
    await provisionAddon(email, cus, sub);
    const r = webhookRequest();
    await setRecovery(env, email, { status: "active", requests_used: 30, overage_units: 2 });

    await routeEvent(env, addonInvoiceEvent(cus, sub, "p1", { start: T1, end: T2 }), r);
    let rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.requests_used, 30);
    assert.equal(rec.overage_units, 2);

    await routeEvent(env, addonInvoiceEvent(cus, sub, "p2", { start: T2, end: T3 }), r);
    rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.requests_used, 0);
    assert.equal(rec.overage_units, 0);
    assert.equal(rec.billing_period_start, iso(T2));
  });
});

describe("7. 51st request blocked at $0 cap — REAL Python ledger+gate", () => {
  const VENV_PY = "/home/hatch/workspace/goals/build-my-ai-automation-company/product/.venv/bin/python";
  const METERING = "/home/hatch/workspace/goals/build-my-ai-automation-company/hidden_files/recovery-metering";

  function gateCheck({ units, allowance = 50, capCents = 0 }) {
    const dir = mkdtempSync(join(tmpdir(), "gate-"));
    try {
      const code = `
import importlib.util, json, os, sys
PKG = ${JSON.stringify(METERING)}
spec = importlib.util.spec_from_file_location("recovery_metering", os.path.join(PKG, "__init__.py"), submodule_search_locations=[PKG])
mod = importlib.util.module_from_spec(spec); sys.modules["recovery_metering"] = mod; spec.loader.exec_module(mod)
ledger = sys.modules["recovery_metering.ledger"]; gate = sys.modules["recovery_metering.gate"]
d = ${JSON.stringify(dir)}
ent = {"email": "gate@example.com", "billing_period_start": "2026-10-01T00:00:00-05:00",
       "billing_period_end": "2026-11-01T00:00:00-05:00", "allowance": ${allowance}, "overage_cap_cents": ${capCents}}
ledger.apply_entitlement(d, ent)
if ${units} > 0:
    ledger.add_billed_units(d, "gate@example.com", ent["billing_period_start"], ["req_%d" % i for i in range(${units})])
row = ledger.get_row(d, "gate@example.com", ent["billing_period_start"])
print(json.dumps({"decision": gate.can_send(ent, row), "requests_used": row["requests_used"], "overage_units": row["overage_units"]}))
`;
      const out = execFileSync(VENV_PY, ["-c", code], { encoding: "utf8" });
      return JSON.parse(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("50 used -> 51st send is QUEUED at $0 cap (never sent, never billed)", () => {
    const r = gateCheck({ units: 50, capCents: 0 });
    assert.equal(r.requests_used, 50);
    assert.equal(r.decision.allowed, false);
    assert.equal(r.decision.reason, "queued_cap");
  });

  it("49 used -> the 50th send is allowed within the allowance", () => {
    const r = gateCheck({ units: 49, capCents: 0 });
    assert.equal(r.decision.allowed, true);
    assert.equal(r.decision.reason, "within_allowance");
  });

  it("overage allowed only inside an approved cap ($20 cap -> 51st sends as overage)", () => {
    const r = gateCheck({ units: 50, capCents: 2000 });
    assert.equal(r.decision.allowed, true);
    assert.equal(r.decision.reason, "overage_within_cap");
  });

  it("cap exhausted -> queued even with a cap set ($2 cap covers exactly 1 overage unit)", () => {
    const r = gateCheck({ units: 51, capCents: 200 });
    assert.equal(r.requests_used, 51);
    assert.equal(r.overage_units, 1);
    assert.equal(r.decision.allowed, false);
    assert.equal(r.decision.reason, "queued_cap");
  });
});

describe("8. pause + authorization withdrawal stop eligibility", () => {
  it("customer pause stops the engine; resume restores", async () => {
    const email = "pause@example.com";
    await provisionAddon(email);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });
    assert.equal((await eligibility(email)).eligible, true);

    const p = await pausePost({
      request: authedPost(cookie, {}, "https://test.freightfolio.net/api/recovery/pause"),
      env,
    }).then((r) => r.json());
    assert.equal(p.ok, true);
    assert.equal(p.status, "paused");
    assert.equal((await eligibility(email)).eligible, false);
    assert.equal(recoveryEntitled(await getCustomer(env, email)), false);

    const rs = await resumePost({
      request: authedPost(cookie, {}, "https://test.freightfolio.net/api/recovery/resume"),
      env,
    }).then((r) => r.json());
    assert.equal(rs.ok, true);
    assert.equal(rs.status, "active");
    assert.equal((await eligibility(email)).eligible, true);
  });

  it("ops authorization withdrawal stops eligibility with a clear reason", async () => {
    const email = "withdraw@example.com";
    await provisionAddon(email);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });
    assert.equal((await eligibility(email)).eligible, true);

    const cleared = await adminAction({ action: "clear_authorization", email, actor: "ops" });
    assert.equal(cleared.ok, true);
    const elig = await eligibility(email);
    assert.equal(elig.eligible, false);
    assert.ok(elig.reasons.includes("authorization_incomplete: authorized_at not set"));
    assert.ok(elig.reasons.includes("setup_not_approved"));
  });

  it("resume is rejected while reauthorization is pending", async () => {
    const email = "resume-reauth@example.com";
    await provisionAddon(email);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });
    await pausePost({ request: authedPost(cookie, {}), env });
    await setRecovery(env, email, { reauth_required: true });
    const rs = await resumePost({ request: authedPost(cookie, {}), env }).then((r) => r.json());
    assert.equal(rs.ok, false);
    assert.equal(rs.error, "reauthorization_required");
  });
});

describe("9. managed_included blocks the $99 purchase", () => {
  it("add-on checkout is rejected as a duplicate for managed customers", async () => {
    const email = "managed@example.com";
    await adminAction({ action: "set_managed", email, actor: "ops" });
    const r = await routeEvent(
      env,
      addonCheckoutEvent(email, "cus_mgd", "sub_mgd"),
      webhookRequest()
    );
    assert.equal(r.intake.recovery.ok, false);
    assert.equal(r.intake.recovery.error, "managed_included_duplicate");
    const rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.entitlement, "managed_included");
    assert.equal(recoveryEntitled(await getCustomer(env, email)), true);

    // managed customers CAN still onboard via the same setup flow
    const cookie = await sessionFor(email);
    const good = await setupPost({
      request: authedPost(cookie, onboardingBody(), "https://test.freightfolio.net/api/recovery/setup"),
      env,
    }).then((r) => r.json());
    assert.equal(good.ok, true);
    assert.equal((await eligibility(email)).eligible, true);
  });
});

describe("10. pilot event never creates entitlement", () => {
  it("$9.99 one-time pilot checkout leaves recovery at none", async () => {
    const email = "pilot@example.com";
    const ev = {
      id: "evt_pilot_int",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          mode: "payment",
          amount_total: 999,
          currency: "usd",
          payment_status: "paid",
          customer_details: { email },
        },
      },
    };
    await routeEvent(env, ev, webhookRequest());
    const rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.entitlement, "none");

    const cookie = await sessionFor(email);
    const me = await getMe({
      request: new Request("https://test.freightfolio.net/api/me", {
        headers: { cookie: `ff_session=${cookie}` },
      }),
      env,
    }).then((r) => r.json());
    assert.equal(me.ok, true);
    assert.equal(me.recovery, null); // workspace renders the upsell
  });
});

describe("11. customer isolation — A cannot touch B's recovery record", () => {
  it("session identity wins: body emails are ignored on every self-serve endpoint", async () => {
    const a = "alice@example.com";
    const b = "bob@example.com";
    await provisionAddon(a, "cus_a", "sub_a");
    await provisionAddon(b, "cus_b", "sub_b");
    const cookieA = await sessionFor(a);
    const cookieB = await sessionFor(b);

    // A onboards; B untouched
    await setupPost({ request: authedPost(cookieA, onboardingBody()), env });
    assert.equal(getRecovery(await getCustomer(env, b)).status, "awaiting_setup");
    assert.equal(getRecovery(await getCustomer(env, a)).status, "active");

    // A tries to smuggle B's email in the body of every endpoint
    const smuggled = { email: b, overage_cap_cents: 5000 };
    await overageCapPost({
      request: authedPost(cookieA, smuggled, "https://test.freightfolio.net/api/recovery/overage-cap"),
      env,
    }).then((r) => r.json());
    assert.equal(getRecovery(await getCustomer(env, a)).overage_cap_cents, 5000);
    assert.equal(getRecovery(await getCustomer(env, b)).overage_cap_cents, 0);

    await pausePost({
      request: authedPost(cookieA, { email: b }, "https://test.freightfolio.net/api/recovery/pause"),
      env,
    }).then((r) => r.json());
    assert.equal(getRecovery(await getCustomer(env, a)).status, "paused");
    assert.equal(getRecovery(await getCustomer(env, b)).status, "awaiting_setup");

    // unauthenticated calls are rejected
    const anon = await pausePost({
      request: mockRequest({}, { url: "https://test.freightfolio.net/api/recovery/pause" }),
      env,
    });
    assert.equal(anon.status, 401);
    void cookieB;
  });
});

describe("12. overage-cap rules", () => {
  it("raise allowed; lower allowed (future-only); never below incurred", async () => {
    const email = "cap@example.com";
    await provisionAddon(email);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });

    const post = (cents) =>
      overageCapPost({
        request: authedPost(cookie, { overage_cap_cents: cents }, "https://test.freightfolio.net/api/recovery/overage-cap"),
        env,
      }).then((r) => r.json());

    let r = await post(5000);
    assert.equal(r.ok, true);
    assert.equal(r.overage_cap_cents, 5000);

    // incur one overage unit ($2.00)
    await setRecovery(env, email, { overage_units: 1, requests_used: 51 });

    r = await post(100); // below the $2.00 already incurred
    assert.equal(r.ok, false);
    assert.equal(r.error, "cap_below_incurred");
    assert.equal(r.incurred_cents, 200);

    r = await post(200); // exactly at incurred: allowed
    assert.equal(r.ok, true);

    r = await post(0); // disable overage: allowed only when nothing incurred... but $2 IS incurred
    assert.equal(r.ok, false);

    // negative and non-integer rejected
    const bad = await overageCapPost({
      request: authedPost(cookie, { overage_cap_cents: -50 }, "https://test.freightfolio.net/api/recovery/overage-cap"),
      env,
    }).then((res) => res.json());
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_cap");
  });
});

describe("13. reauthorization trigger on config change", () => {
  it("changing contacts pauses outreach; resubmitting re-approves", async () => {
    const email = "reauth@example.com";
    await provisionAddon(email);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });
    assert.equal((await eligibility(email)).eligible, true);

    // update with a changed contact -> reauth triggered, outreach paused
    const changed = onboardingBody();
    changed.contacts.carrier = { name: "New Driver", email: "new@example.com" };
    const upd = await setupPost({
      request: authedPost(cookie, changed, "https://test.freightfolio.net/api/recovery/setup"),
      env,
    }).then((r) => r.json());
    assert.equal(upd.ok, true);
    assert.equal(upd.reauth_triggered, true);
    assert.equal(upd.reauth_required, true);
    const rec = getRecovery(await getCustomer(env, email));
    assert.equal(rec.setup.contacts.carrier.email, "new@example.com"); // new config saved
    assert.ok(rec.reauth_pending_since);

    let elig = await eligibility(email);
    assert.equal(elig.eligible, false);
    assert.ok(elig.reasons.some((x) => x.startsWith("reauthorization_required")));

    // resubmitting the same config re-approves -> eligible again
    const re = await setupPost({
      request: authedPost(cookie, changed, "https://test.freightfolio.net/api/recovery/setup"),
      env,
    }).then((r) => r.json());
    assert.equal(re.ok, true);
    assert.equal(re.reapproved, true);
    assert.equal(re.reauth_required, false);
    elig = await eligibility(email);
    assert.equal(elig.eligible, true);
  });

  it("requirement/cap-only changes do not trigger reauth", async () => {
    const email = "noreauth@example.com";
    await provisionAddon(email);
    const cookie = await sessionFor(email);
    await setupPost({ request: authedPost(cookie, onboardingBody()), env });

    const tweak = onboardingBody({ requirements: ["bol"], overage_cap_cents: 2000 });
    const upd = await setupPost({
      request: authedPost(cookie, tweak, "https://test.freightfolio.net/api/recovery/setup"),
      env,
    }).then((r) => r.json());
    assert.equal(upd.ok, true);
    assert.equal(upd.reauth_triggered, false);
    assert.equal((await eligibility(email)).eligible, true);
  });
});

describe("14. /api/me + admin read surface real recovery data", () => {
  it("me.recovery matches the workspace tab contract; admin lists entitlements + audit", async () => {
    const email = "surface@example.com";
    await provisionAddon(email);
    const cookie = await sessionFor(email);
    await setupPost({
      request: authedPost(cookie, onboardingBody({ overage_cap_cents: 2000 })),
      env,
    });

    const me = await getMe({
      request: new Request("https://test.freightfolio.net/api/me", {
        headers: { cookie: `ff_session=${cookie}` },
      }),
      env,
    }).then((r) => r.json());
    const r = me.recovery;
    assert.equal(r.entitlement, "addon");
    assert.equal(r.status, "active");
    assert.equal(r.allowance, 50);
    assert.equal(r.requests_used, 0);
    assert.equal(r.overage_cap_cents, 2000);
    assert.equal(r.overage_used_cents, 0);
    assert.equal(r.reauth_required, false);
    assert.equal(r.cancel_scheduled, false);
    assert.ok(r.setup.contacts.carrier.email === "jane@example.com");
    assert.ok(r.next_period_start);

    // admin read (ops email session)
    const { cookieValue: adminCookie } = await createSession(env, "freightfolio.ops@gmail.com", "admin");
    const adminRes = await adminRecoveryGet({
      request: new Request("https://test.freightfolio.net/api/admin/recovery", {
        headers: { cookie: `ff_session=${adminCookie}` },
      }),
      env,
    }).then((x) => x.json());
    assert.equal(adminRes.ok, true);
    const row = adminRes.entitlements.find((e) => e.email === email);
    assert.ok(row);
    assert.equal(row.status, "active");
    assert.equal(row.requests_remaining, 50);
    assert.ok(Array.isArray(adminRes.audit));
    assert.ok(adminRes.audit.length >= 1);
    assert.ok(adminRes.audit.some((a) => a.action === "customer_setup"));

    // non-admin denied
    const denied = await adminRecoveryGet({
      request: new Request("https://test.freightfolio.net/api/admin/recovery", {
        headers: { cookie: `ff_session=${cookie}` },
      }),
      env,
    });
    assert.equal(denied.status, 403);
  });
});
