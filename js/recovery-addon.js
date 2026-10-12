/**
 * js/recovery-addon.js — Missing-Document Recovery ($99/mo add-on) helpers.
 *
 * Pure, framework-free helpers shared by the customer workspace (upsell,
 * onboarding, active management) and the ops console. All DOM rendering stays
 * in workspace.js / admin.js; this file only contains unit-testable logic.
 *
 * Browser: exposes window.RecoveryAddon. Node: module.exports (for node:test).
 */

(function (root, factory) {
  "use strict";
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.RecoveryAddon = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RECOVERY = {
    // LOUD: the billing workstream owns this. Mike must create a $99/mo
    // recurring payment link in the Stripe dashboard and replace the value
    // below. NEVER invent a real-looking link and NEVER reuse the pilot link
    // (the pilot is one-time $9.99 and must never create a subscription).
    PAYMENT_LINK: "https://buy.stripe.com/fZueVcerNbGKgRXcNnabK0c",
    PRICE_CENTS: 9900,
    ALLOWANCE: 50,             // document requests included per month
    OVERAGE_CENTS_PER_REQUEST: 200, // $2.00 per request beyond allowance
    DEFAULT_OVERAGE_CAP_CENTS: 0,   // default: no overage charges possible
    TIMEZONES: ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
  };

  var BASE_PLANS = [
    { key: "starter", name: "Starter", price_cents: 3900 },
    { key: "business", name: "Business", price_cents: 14900 },
    { key: "premium", name: "Premium", price_cents: 36900 },
  ];

  var ENTITLEMENT_LABELS = {
    none: "Not added",
    addon: "Recovery add-on",
    managed_included: "Included (managed billing)",
  };

  var STATUS_LABELS = {
    awaiting_setup: "Awaiting setup",
    active: "Active",
    paused: "Paused",
    canceled: "Canceled",
    past_due: "Past due",
    grace: "Grace period",
  };

  var REQUEST_STATUS_LABELS = {
    open: "Open",
    recovered: "Recovered",
    overdue: "Overdue",
    escalated: "Escalated",
  };

  // Endpoints owned by the billing workstream. They may not exist yet; the UI
  // degrades gracefully (inline error, no crash) when any of them 404s.
  var ENDPOINTS = {
    setup: "/api/recovery/setup",           // POST onboarding (creates setup; triggers authorization)
    updateContacts: "/api/recovery/setup",  // POST contact/identity/template/cadence update (triggers reauthorization)
    pause: "/api/recovery/pause",           // POST
    resume: "/api/recovery/resume",         // POST
    overageCap: "/api/recovery/overage-cap", // POST { overage_cap_cents }
    cancel: "/api/recovery/cancel",         // POST
    admin: "/api/admin/recovery",           // GET entitlements, exceptions, audit (admin only)
  };

  function fmtMoney(cents) {
    var n = Number(cents);
    if (!isFinite(n)) n = 0;
    return "$" + (n / 100).toFixed(2).replace(/\.00$/, "");
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  /**
   * Defensive normalization of me.recovery. Returns null when the customer
   * has no recovery data at all (billing workstream may not populate it yet).
   */
  function normalizeRecovery(recovery) {
    if (recovery == null || typeof recovery !== "object") return null;
    var allowance = num(recovery.allowance, RECOVERY.ALLOWANCE);
    var used = num(recovery.requests_used, 0);
    return {
      entitlement: recovery.entitlement || "none",
      status: recovery.status || "awaiting_setup",
      allowance: allowance,
      requests_used: used,
      requests_remaining: Math.max(0, allowance - used),
      overage_cap_cents: num(recovery.overage_cap_cents, RECOVERY.DEFAULT_OVERAGE_CAP_CENTS),
      overage_used_cents: num(recovery.overage_used_cents, 0),
      setup: recovery.setup || {},
      requests: Array.isArray(recovery.requests) ? recovery.requests : [],
      exceptions: Array.isArray(recovery.exceptions) ? recovery.exceptions : [],
      reauth_required: recovery.reauth_required === true,
      since: recovery.since || null,
      next_period_start: recovery.next_period_start || null,
      cancel_scheduled: recovery.cancel_scheduled === true,
      service_end_at: recovery.service_end_at || null,
    };
  }

  function isEntitled(r) {
    return !!r && (r.entitlement === "addon" || r.entitlement === "managed_included");
  }

  function isOperational(r) {
    return !!r && isEntitled(r) && r.status === "active" && !r.reauth_required;
  }

  function statusLabel(s) { return STATUS_LABELS[s] || s; }
  function entitlementLabel(e) { return ENTITLEMENT_LABELS[e] || e; }
  function requestStatusLabel(s) { return REQUEST_STATUS_LABELS[s] || s; }

  /** Base + add-on + total example for one base plan (copy discipline). */
  function planTotalExample(planKey) {
    var plan = null;
    for (var i = 0; i < BASE_PLANS.length; i++) {
      if (BASE_PLANS[i].key === planKey) plan = BASE_PLANS[i];
    }
    if (!plan) plan = BASE_PLANS[0];
    return {
      plan_name: plan.name,
      base: fmtMoney(plan.price_cents),
      addon: fmtMoney(RECOVERY.PRICE_CENTS),
      total: fmtMoney(plan.price_cents + RECOVERY.PRICE_CENTS),
    };
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function isValidEmail(s) { return EMAIL_RE.test(String(s || "").trim()); }

  var CONTACT_ROLES = [
    { key: "carrier", label: "Carrier" },
    { key: "dispatcher", label: "Dispatcher" },
    { key: "shipper", label: "Shipper" },
    { key: "escalation", label: "Escalation" },
  ];

  var DOCUMENT_REQUIREMENTS = [
    { key: "rate_con", label: "Rate confirmation" },
    { key: "bol", label: "Bill of lading" },
    { key: "pod", label: "Proof of delivery" },
    { key: "exception_receipts", label: "Exception receipts (detention, lumper, TONU)" },
  ];

  var DEFAULT_TEMPLATES = {
    first_request_subject: "Missing document for load {{load_id}}",
    first_request_body: "Hi {{contact_name}},\n\nWe are missing the {{document_type}} for load {{load_id}} ({{shipper}} to {{consignee}}, {{date}}). Could you reply to this email with the document attached?\n\nThank you,\n{{sender_name}}",
    reminder_subject: "Reminder: missing {{document_type}} for load {{load_id}}",
    reminder_body: "Hi {{contact_name}},\n\nFollowing up on the {{document_type}} for load {{load_id}}. If you already sent it, please ignore this message.\n\nThank you,\n{{sender_name}}",
    escalation_subject: "Escalation: {{document_type}} still missing for load {{load_id}}",
    escalation_body: "Hi {{contact_name}},\n\nThis is our third request for the {{document_type}} for load {{load_id}}. Billing for this load is blocked until it arrives. Please send it today if possible.\n\nThank you,\n{{sender_name}}",
  };

  var DEFAULT_CADENCE = {
    days_between_attempts: 3,
    max_attempts: 3,
    escalate_after_attempts: 2,
  };

  function defaultOnboarding() {
    var contacts = {};
    CONTACT_ROLES.forEach(function (r) { contacts[r.key] = { name: "", email: "" }; });
    return {
      contacts: contacts,
      permission: false,
      sender_name: "",
      sender_email: "",
      reply_to: "",
      templates: Object.assign({}, DEFAULT_TEMPLATES),
      cadence: Object.assign({}, DEFAULT_CADENCE),
      timezone: "America/Chicago",
      escalation_rule: "After " + DEFAULT_CADENCE.escalate_after_attempts + " unanswered attempts, escalate to the escalation contact.",
      requirements: DOCUMENT_REQUIREMENTS.map(function (d) { return d.key; }),
      overage_cap_dollars: 0,
    };
  }

  /**
   * Merge saved setup (from /api/me recovery.setup) over the defaults so the
   * onboarding form is prefilled when reauthorization is required.
   */
  function prefillOnboarding(saved) {
    var d = defaultOnboarding();
    if (!saved || typeof saved !== "object") return d;
    var out = Object.assign({}, d);
    if (saved.contacts && typeof saved.contacts === "object") {
      CONTACT_ROLES.forEach(function (r) {
        var c = saved.contacts[r.key];
        if (c && typeof c === "object") {
          out.contacts[r.key] = { name: String(c.name || ""), email: String(c.email || "") };
        }
      });
    }
    ["sender_name", "sender_email", "reply_to", "timezone", "escalation_rule"].forEach(function (k) {
      if (typeof saved[k] === "string" && saved[k]) out[k] = saved[k];
    });
    if (saved.templates && typeof saved.templates === "object") {
      Object.keys(DEFAULT_TEMPLATES).forEach(function (k) {
        if (typeof saved.templates[k] === "string" && saved.templates[k]) out.templates[k] = saved.templates[k];
      });
    }
    if (saved.cadence && typeof saved.cadence === "object") {
      Object.keys(DEFAULT_CADENCE).forEach(function (k) {
        var n = num(saved.cadence[k], DEFAULT_CADENCE[k]);
        out.cadence[k] = n > 0 ? n : DEFAULT_CADENCE[k];
      });
    }
    if (Array.isArray(saved.requirements) && saved.requirements.length) {
      out.requirements = saved.requirements.filter(function (k) {
        return DOCUMENT_REQUIREMENTS.some(function (dr) { return dr.key === k; });
      });
    }
    if (typeof saved.overage_cap_cents !== "undefined") {
      out.overage_cap_dollars = num(saved.overage_cap_cents, 0) / 100;
    }
    return out;
  }

  /**
   * Validate onboarding data. Returns an array of {field, message}; empty
   * means valid. "field" keys map to form input ids prefixed with "rco-".
   */
  function validateOnboarding(d) {
    var errors = [];
    var hasAny = false;
    CONTACT_ROLES.forEach(function (r) {
      var c = (d && d.contacts && d.contacts[r.key]) || {};
      var name = String(c.name || "").trim();
      var email = String(c.email || "").trim();
      if (name || email) {
        hasAny = true;
        if (!name) errors.push({ field: "contact-name-" + r.key, message: "Enter a name for the " + r.label.toLowerCase() + " contact." });
        if (!email) errors.push({ field: "contact-email-" + r.key, message: "Enter an email for the " + r.label.toLowerCase() + " contact." });
        else if (!isValidEmail(email)) errors.push({ field: "contact-email-" + r.key, message: "That " + r.label.toLowerCase() + " email does not look valid." });
      }
    });
    if (!hasAny) {
      errors.push({ field: "contact-email-carrier", message: "Add at least one approved contact (name and email) so we know where to send requests." });
    }
    if (!d || d.permission !== true) {
      errors.push({ field: "permission", message: "Authorization is required before we can contact anyone on your behalf." });
    }
    if (!d || !String(d.sender_name || "").trim()) {
      errors.push({ field: "sender-name", message: "Enter the name requests are sent from." });
    }
    if (!d || !isValidEmail(d.sender_email)) {
      errors.push({ field: "sender-email", message: "Enter a valid sending email address." });
    }
    if (d && d.reply_to && !isValidEmail(d.reply_to)) {
      errors.push({ field: "reply-to", message: "The reply-to address does not look valid." });
    }
    if (!d || !String(d.timezone || "").trim()) {
      errors.push({ field: "timezone", message: "Choose a timezone." });
    }
    ["first_request_subject", "reminder_subject", "escalation_subject"].forEach(function (k) {
      if (!d || !d.templates || !String(d.templates[k] || "").trim()) {
        errors.push({ field: "tpl-" + k.replace(/_/g, "-"), message: "Every email template needs a subject line." });
      }
    });
    ["first_request_body", "reminder_body", "escalation_body"].forEach(function (k) {
      if (!d || !d.templates || !String(d.templates[k] || "").trim()) {
        errors.push({ field: "tpl-" + k.replace(/_/g, "-"), message: "Every email template needs body text." });
      }
    });
    if (d && d.cadence) {
      var days = num(d.cadence.days_between_attempts, NaN);
      if (!isFinite(days) || days < 1) {
        errors.push({ field: "cadence-days", message: "Days between attempts must be at least 1." });
      }
      var max = num(d.cadence.max_attempts, NaN);
      if (!isFinite(max) || max < 1) {
        errors.push({ field: "cadence-max", message: "Max attempts must be at least 1." });
      }
    }
    if (!d || !Array.isArray(d.requirements) || !d.requirements.length) {
      errors.push({ field: "req-rate_con", message: "Select at least one document type we should chase." });
    }
    var cap = parseOverageCap(d ? d.overage_cap_dollars : 0);
    if (!cap.ok) errors.push({ field: "overage-cap", message: cap.message });
    return errors;
  }

  /**
   * Parse a dollar input into cents. Default (blank/0) means no overage
   * charges are possible.
   */
  function parseOverageCap(v) {
    if (v === "" || v === null || typeof v === "undefined") return { ok: true, cents: RECOVERY.DEFAULT_OVERAGE_CAP_CENTS };
    var n = Number(v);
    if (!isFinite(n)) return { ok: false, message: "Enter a number, like 50 or 0.", cents: 0 };
    if (n < 0) return { ok: false, message: "The overage cap cannot be negative. Use 0 to block all overage charges.", cents: 0 };
    if (Math.round(n * 100) !== n * 100) return { ok: false, message: "Use whole cents (up to 2 decimals).", cents: 0 };
    return { ok: true, cents: Math.round(n * 100) };
  }

  /**
   * Overage editor rule: a customer may lower or disable the cap for future
   * charges. It never reduces charges already incurred.
   */
  function overageCapChange(currentCents, proposedCents) {
    var change = { allowed: true, note: "" };
    if (proposedCents < 0) {
      change.allowed = false;
      change.note = "The cap cannot be negative.";
      return change;
    }
    if (proposedCents < num(currentCents, 0)) {
      change.note = "Lowering the cap only affects future requests. Charges already incurred are not affected.";
    } else if (proposedCents === 0) {
      change.note = "Overage is off. Requests beyond your 50 per month will wait in the queue instead of billing $2 each.";
    } else {
      change.note = "Raising the cap allows more overage requests at $2 each, up to this cap.";
    }
    return change;
  }

  return {
    RECOVERY: RECOVERY,
    BASE_PLANS: BASE_PLANS,
    ENDPOINTS: ENDPOINTS,
    CONTACT_ROLES: CONTACT_ROLES,
    DOCUMENT_REQUIREMENTS: DOCUMENT_REQUIREMENTS,
    DEFAULT_TEMPLATES: DEFAULT_TEMPLATES,
    DEFAULT_CADENCE: DEFAULT_CADENCE,
    fmtMoney: fmtMoney,
    normalizeRecovery: normalizeRecovery,
    isEntitled: isEntitled,
    isOperational: isOperational,
    statusLabel: statusLabel,
    entitlementLabel: entitlementLabel,
    requestStatusLabel: requestStatusLabel,
    planTotalExample: planTotalExample,
    isValidEmail: isValidEmail,
    defaultOnboarding: defaultOnboarding,
    prefillOnboarding: prefillOnboarding,
    validateOnboarding: validateOnboarding,
    parseOverageCap: parseOverageCap,
    overageCapChange: overageCapChange,
  };
});
