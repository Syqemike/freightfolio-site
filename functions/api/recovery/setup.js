/**
 * POST /api/recovery/setup — customer self-serve recovery onboarding.
 *
 * Session-authed ONLY (requireSession). The customer identity comes from the
 * session; any email in the body is ignored (customer isolation).
 *
 * Contract with the billing workstream (lib/customer.js):
 *   - Payment alone never enables chasing. This endpoint records the
 *     customer authorization (the (b) leg of the eligibility rule) using the
 *     same flags as the internal recovery-admin set_authorization action:
 *     authorized_at/authorized_by + setup.{approved, config_valid,
 *     contacts_approved}.
 *   - The submit button reads "Authorize and activate": a FIRST submit with
 *     valid data promotes awaiting_setup -> active, because the validated
 *     authorization + operational config now satisfies eligibility legs (b)
 *     and (c). A Stripe webhook can never do this (it never promotes
 *     awaiting_setup -> active).
 *   - managed_included customers may onboard the same way.
 *
 * REAUTHORIZATION TRIGGER (update path):
 *   When the customer changes contacts / sending identity / templates /
 *   cadence, the new config is saved but reauth_required=true is set; the
 *   eligibility endpoint treats that as ineligible so affected outreach
 *   pauses until the customer re-approves (a second submit of the same
 *   form, which arrives with reauth_required already true, clears it).
 *   Requirement selections never trigger reauth.
 *
 * Server-side validation reuses js/recovery-addon.js validateOnboarding
 * (single source of truth with the client).
 */

import { json, requireSession } from "../../../lib/api-auth.js";
import {
  getCustomer,
  getRecovery,
  setRecovery,
  applyRecoveryLifecycle,
} from "../../../lib/customer.js";
import {
  auditRecovery,
  recoverySummary,
  recoverySelfServeAllowed,
} from "../../../lib/recovery-api.js";
import RA from "../../../js/recovery-addon.js";

function str(v, max = 500) {
  if (v === null || v === undefined) return "";
  return String(v).slice(0, max).trim();
}

function emailStr(v) {
  return str(v, 254).toLowerCase();
}

function sanitizeOnboarding(body) {
  const b = body && typeof body === "object" ? body : {};
  const contacts = {};
  for (const role of RA.CONTACT_ROLES) {
    const c = (b.contacts && b.contacts[role.key]) || {};
    contacts[role.key] = { name: str(c.name, 200), email: emailStr(c.email) };
  }
  const templates = {};
  for (const k of Object.keys(RA.DEFAULT_TEMPLATES)) {
    templates[k] = str(b.templates && b.templates[k], 4000);
  }
  const cad = (b.cadence && typeof b.cadence === "object") ? b.cadence : {};
  return {
    contacts,
    permission: b.permission === true,
    sender_name: str(b.sender_name, 200),
    sender_email: emailStr(b.sender_email),
    reply_to: emailStr(b.reply_to),
    templates,
    cadence: {
      days_between_attempts: Number(cad.days_between_attempts) || 0,
      max_attempts: Number(cad.max_attempts) || 0,
      escalate_after_attempts: RA.DEFAULT_CADENCE.escalate_after_attempts,
    },
    timezone: str(b.timezone, 80),
    escalation_rule: str(b.escalation_rule, 1000),
    requirements: Array.isArray(b.requirements)
      ? b.requirements
          .map((k) => str(k, 60))
          .filter((k) => RA.DOCUMENT_REQUIREMENTS.some((d) => d.key === k))
      : [],
  };
}

/** Identity snapshot used to detect reauth-triggering changes. */
function identitySnapshot(setup) {
  const s = setup || {};
  return {
    contacts: s.contacts || {},
    sender_name: s.sender_name || "",
    sender_email: s.sender_email || "",
    reply_to: s.reply_to || "",
    templates: s.templates || {},
    cadence: s.cadence || {},
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const email = auth.session.email;

  const customer = await getCustomer(env, email);
  if (!customer) return json({ ok: false, error: "no_customer" }, 404);
  await applyRecoveryLifecycle(env, email);
  const rec = getRecovery(await getCustomer(env, email));

  if (!recoverySelfServeAllowed(rec)) {
    return json({ ok: false, error: "no_recovery_entitlement" }, 409);
  }
  if (rec.status === "canceled") {
    return json({ ok: false, error: "addon_canceled" }, 409);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const data = sanitizeOnboarding(body);

  // Server-side validation (same rules as the client).
  const errors = RA.validateOnboarding(data);
  // RC-04 (audit 2026-10-12): sender_email is the Resend envelope From and
  // hard-fails at the provider when its domain is not verified. If the
  // requested domain is not on the verified-sender allowlist (env
  // VERIFIED_SENDER_DOMAINS, comma-separated; defaults to freightfolio.net),
  // we keep the request on file but SEND from hello@freightfolio.net until
  // the customer's domain is verified in Resend. Never silently fail at
  // send time; the fallback is explicit in the stored config + response.
  let senderFallback = null;
  if (data.sender_email) {
    const domain = (data.sender_email.split("@")[1] || "").toLowerCase();
    const allowlist = String(
      env.VERIFIED_SENDER_DOMAINS || "freightfolio.net"
    ).toLowerCase().split(",").map((d) => d.trim()).filter(Boolean);
    if (!allowlist.includes(domain)) {
      senderFallback = {
        requested: data.sender_email,
        enforced: "hello@freightfolio.net",
        reason: "@" + domain + " is not a verified sending domain yet",
      };
      data.sender_email = "hello@freightfolio.net";
    }
  }
  if (errors.length > 0) {
    return json({ ok: false, error: "invalid_setup", errors }, 400);
  }

  const nowIso = new Date().toISOString();
  const firstAuthorization = !rec.authorized_at;
  const wasReauthPending = rec.reauth_required === true;
  // A "change" only exists against a previously saved operational config.
  // A managed/ops-pre-authorized record with no setup yet is receiving its
  // INITIAL config — not a change — and must not trigger reauthorization.
  const hadSetup = Boolean(
    rec.setup && rec.setup.contacts && Object.keys(rec.setup.contacts).length > 0
  );
  const changed =
    hadSetup &&
    JSON.stringify(identitySnapshot(rec.setup)) !==
      JSON.stringify(identitySnapshot(data));

  const setup = {
    ...data,
    approved: true,
    config_valid: true,
    contacts_approved: true,
    updated_at: nowIso,
  };
  delete setup.permission;
  // RC-04: keep the unverified-domain request on file (ops can verify the
  // domain in Resend later and flip sender_email back), but the enforced
  // sender is always a verified domain.
  if (senderFallback) {
    setup.requested_sender_email = senderFallback.requested;
    setup.sender_domain_status =
      "unverified — sending from " + senderFallback.enforced +
      " until @" + (senderFallback.requested.split("@")[1] || "") +
      " is verified in Resend";
  } else {
    delete setup.requested_sender_email;
    delete setup.sender_domain_status;
  }

  const patch = {
    setup,
  };

  let activated = false;
  let reauthTriggered = false;
  let reapproved = false;

  if (firstAuthorization || !hadSetup) {
    // (Re-)recording the authorization: the first validated onboarding, or
    // the first operational config on a record ops already authorized
    // (e.g. managed_included). Validated authorization + operational config
    // satisfies eligibility legs (b) and (c).
    if (firstAuthorization) {
      patch.authorized_at = nowIso;
      patch.authorized_by = email;
    }
    patch.reauth_required = false;
    patch.reauth_pending_since = null;
    if (rec.status === "awaiting_setup") {
      patch.status = "active";
      activated = true;
    }
  } else if (changed) {
    // Update to contacts/identity/templates/cadence: save the new config
    // but require re-approval before outreach resumes.
    patch.reauth_required = true;
    patch.reauth_pending_since = nowIso;
    reauthTriggered = true;
  } else if (wasReauthPending) {
    // Same data resubmitted while reauth was pending: the customer is
    // re-approving the changes — outreach may resume.
    patch.reauth_required = false;
    patch.reauth_pending_since = null;
    reapproved = true;
  }

  const next = await setRecovery(env, email, patch);
  await auditRecovery(env, {
    action: firstAuthorization ? "customer_setup" : "customer_setup_update",
    email,
    actor: `customer:${email}`,
    detail: { activated, reauth_triggered: reauthTriggered, reapproved },
  });

  return json({
    ok: true,
    email,
    activated,
    reauth_triggered: reauthTriggered,
    reapproved,
    reauth_required: next.reauth_required === true,
    status: next.status,
    sender_fallback: senderFallback,
    recovery: recoverySummary(next),
  });
}
