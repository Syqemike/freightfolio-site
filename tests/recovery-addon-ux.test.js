/**
 * tests/recovery-addon-ux.test.js — unit tests for the Missing-Document
 * Recovery add-on UX helpers (js/recovery-addon.js).
 *
 * These helpers drive the Recovery tab upsell/onboarding/active views and the
 * ops-console recovery section. DOM rendering stays in workspace.js/admin.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RA = require("../js/recovery-addon.js");

function validOnboarding() {
  const d = RA.defaultOnboarding();
  d.contacts.carrier = { name: "Jane Driver", email: "jane@example.com" };
  d.permission = true;
  d.sender_name = "Acme Brokerage";
  d.sender_email = "billing@acme.com";
  d.reply_to = "";
  d.timezone = "America/Chicago";
  return d;
}

describe("recovery constants", () => {
  it("prices the add-on at $99/mo with the contracted terms", () => {
    assert.equal(RA.RECOVERY.PRICE_CENTS, 9900);
    assert.equal(RA.RECOVERY.ALLOWANCE, 50);
    assert.equal(RA.RECOVERY.OVERAGE_CENTS_PER_REQUEST, 200);
    assert.equal(RA.RECOVERY.DEFAULT_OVERAGE_CAP_CENTS, 0);
  });
  it("uses a placeholder payment link that must be created in the dashboard", () => {
    assert.ok(RA.RECOVERY.PAYMENT_LINK.includes("REPLACE_ME"));
    assert.ok(!RA.RECOVERY.PAYMENT_LINK.includes("cNibJ083pbGKeJP6oZabK0b"),
      "must never reuse the one-time pilot link");
  });
  it("exposes the assumed action endpoints", () => {
    for (const k of ["setup", "pause", "resume", "overageCap", "cancel", "admin"]) {
      assert.ok(RA.ENDPOINTS[k], k);
      assert.ok(RA.ENDPOINTS[k].startsWith("/api/"), k);
    }
  });
});

describe("normalizeRecovery", () => {
  it("returns null when recovery is absent (billing workstream may not populate it)", () => {
    assert.equal(RA.normalizeRecovery(null), null);
    assert.equal(RA.normalizeRecovery(undefined), null);
    assert.equal(RA.normalizeRecovery("nope"), null);
  });
  it("applies safe defaults to a partial object", () => {
    const r = RA.normalizeRecovery({ entitlement: "addon" });
    assert.equal(r.entitlement, "addon");
    assert.equal(r.status, "awaiting_setup");
    assert.equal(r.allowance, 50);
    assert.equal(r.requests_used, 0);
    assert.equal(r.requests_remaining, 50);
    assert.equal(r.overage_cap_cents, 0);
    assert.equal(r.overage_used_cents, 0);
    assert.equal(r.reauth_required, false);
    assert.deepEqual(r.requests, []);
  });
  it("computes requests_remaining and never goes negative", () => {
    const r = RA.normalizeRecovery({ entitlement: "addon", requests_used: 60, allowance: 50 });
    assert.equal(r.requests_remaining, 0);
  });
});

describe("entitlement gates", () => {
  it("isEntitled only for addon or managed_included", () => {
    assert.equal(RA.isEntitled(RA.normalizeRecovery({ entitlement: "none" })), false);
    assert.equal(RA.isEntitled(RA.normalizeRecovery({ entitlement: "addon" })), true);
    assert.equal(RA.isEntitled(RA.normalizeRecovery({ entitlement: "managed_included" })), true);
    assert.equal(RA.isEntitled(null), false);
  });
  it("isOperational only when active and no reauthorization pending", () => {
    assert.equal(RA.isOperational(RA.normalizeRecovery({ entitlement: "addon", status: "active" })), true);
    assert.equal(RA.isOperational(RA.normalizeRecovery({ entitlement: "addon", status: "active", reauth_required: true })), false);
    assert.equal(RA.isOperational(RA.normalizeRecovery({ entitlement: "addon", status: "paused" })), false);
    assert.equal(RA.isOperational(RA.normalizeRecovery({ entitlement: "addon", status: "awaiting_setup" })), false);
    assert.equal(RA.isOperational(RA.normalizeRecovery({ entitlement: "managed_included", status: "active" })), true);
  });
});

describe("labels and money", () => {
  it("labels statuses and entitlements", () => {
    assert.equal(RA.statusLabel("awaiting_setup"), "Awaiting setup");
    assert.equal(RA.statusLabel("past_due"), "Past due");
    assert.equal(RA.entitlementLabel("managed_included"), "Included (managed billing)");
    assert.equal(RA.requestStatusLabel("overdue"), "Overdue");
  });
  it("formats money", () => {
    assert.equal(RA.fmtMoney(9900), "$99");
    assert.equal(RA.fmtMoney(3900), "$39");
    assert.equal(RA.fmtMoney(2050), "$20.50");
    assert.equal(RA.fmtMoney(0), "$0");
  });
  it("builds base + add-on + total examples", () => {
    const ex = RA.planTotalExample("business");
    assert.equal(ex.base, "$149");
    assert.equal(ex.addon, "$99");
    assert.equal(ex.total, "$248");
  });
  it("validates emails", () => {
    assert.equal(RA.isValidEmail("jane@example.com"), true);
    assert.equal(RA.isValidEmail("not an email"), false);
    assert.equal(RA.isValidEmail(""), false);
  });
});

describe("parseOverageCap", () => {
  it("defaults blank to $0 (no overage possible)", () => {
    assert.deepEqual(RA.parseOverageCap(""), { ok: true, cents: 0 });
    assert.deepEqual(RA.parseOverageCap(0), { ok: true, cents: 0 });
  });
  it("converts dollars to cents", () => {
    assert.deepEqual(RA.parseOverageCap("50"), { ok: true, cents: 5000 });
    assert.deepEqual(RA.parseOverageCap("12.50"), { ok: true, cents: 1250 });
  });
  it("rejects negatives, non-numbers, and sub-cent precision", () => {
    assert.equal(RA.parseOverageCap("-5").ok, false);
    assert.equal(RA.parseOverageCap("abc").ok, false);
    assert.equal(RA.parseOverageCap("10.005").ok, false);
  });
});

describe("overageCapChange", () => {
  it("allows lowering with the incurred-charges caveat", () => {
    const c = RA.overageCapChange(5000, 1000);
    assert.equal(c.allowed, true);
    assert.ok(c.note.toLowerCase().includes("incurred"));
  });
  it("allows disabling to $0", () => {
    const c = RA.overageCapChange(5000, 0);
    assert.equal(c.allowed, true);
  });
  it("rejects negative caps", () => {
    assert.equal(RA.overageCapChange(0, -100).allowed, false);
  });
});

describe("validateOnboarding", () => {
  it("accepts a complete, valid setup", () => {
    assert.deepEqual(RA.validateOnboarding(validOnboarding()), []);
  });
  it("requires at least one approved contact", () => {
    const d = validOnboarding();
    d.contacts.carrier = { name: "", email: "" };
    const errs = RA.validateOnboarding(d);
    assert.ok(errs.some((e) => e.message.toLowerCase().includes("approved contact")));
  });
  it("flags invalid contact emails and missing names", () => {
    const d = validOnboarding();
    d.contacts.carrier = { name: "Jane", email: "bad" };
    assert.ok(RA.validateOnboarding(d).some((e) => e.field === "contact-email-carrier"));
    d.contacts.carrier = { name: "", email: "jane@example.com" };
    assert.ok(RA.validateOnboarding(d).some((e) => e.field === "contact-name-carrier"));
  });
  it("requires the permission checkbox and sending identity", () => {
    const d = validOnboarding();
    d.permission = false;
    assert.ok(RA.validateOnboarding(d).some((e) => e.field === "permission"));
    const d2 = validOnboarding();
    d2.sender_name = " ";
    assert.ok(RA.validateOnboarding(d2).some((e) => e.field === "sender-name"));
    const d3 = validOnboarding();
    d3.sender_email = "bad";
    assert.ok(RA.validateOnboarding(d3).some((e) => e.field === "sender-email"));
  });
  it("requires complete templates, a timezone, and document requirements", () => {
    const d = validOnboarding();
    d.templates.first_request_subject = " ";
    assert.ok(RA.validateOnboarding(d).some((e) => e.field === "tpl-first-request-subject"));
    const d2 = validOnboarding();
    d2.timezone = "";
    assert.ok(RA.validateOnboarding(d2).some((e) => e.field === "timezone"));
    const d3 = validOnboarding();
    d3.requirements = [];
    assert.ok(RA.validateOnboarding(d3).length > 0);
  });
  it("rejects a negative overage cap", () => {
    const d = validOnboarding();
    d.overage_cap_dollars = -5;
    assert.ok(RA.validateOnboarding(d).some((e) => e.field === "overage-cap"));
  });
  it("rejects bad cadence values", () => {
    const d = validOnboarding();
    d.cadence.days_between_attempts = 0;
    assert.ok(RA.validateOnboarding(d).some((e) => e.field === "cadence-days"));
  });
});

describe("prefillOnboarding", () => {
  it("returns defaults when nothing was saved", () => {
    const p = RA.prefillOnboarding(null);
    assert.equal(p.timezone, "America/Chicago");
    assert.equal(p.contacts.carrier.email, "");
    assert.ok(p.templates.first_request_subject.length > 0);
  });
  it("merges saved setup over the defaults", () => {
    const p = RA.prefillOnboarding({
      contacts: { carrier: { name: "Jane", email: "jane@example.com" } },
      sender_name: "Acme",
      timezone: "America/Denver",
      overage_cap_cents: 7500,
    });
    assert.equal(p.contacts.carrier.email, "jane@example.com");
    assert.equal(p.sender_name, "Acme");
    assert.equal(p.timezone, "America/Denver");
    assert.equal(p.overage_cap_dollars, 75);
    assert.equal(p.contacts.dispatcher.email, "");
  });
});
