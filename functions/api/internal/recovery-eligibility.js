/**
 * GET /api/internal/recovery-eligibility?email=
 *
 * Eligibility read for the recovery engine (ops VM worker). Reports whether
 * chasing may run for a customer and why not.
 *
 * Guarded by INTAKE_INTERNAL_KEY (header "x-intake-key", constant-time
 * compare). Never linked publicly. NEVER exposes secrets — the response
 * contains only billing/eligibility state.
 *
 * ELIGIBILITY RULE (the gate the engine enforces — chasing requires ALL THREE):
 *   (a) recoveryEntitled(customer): entitlement "addon"|"managed_included"
 *       AND status "active"|"grace" (or "past_due" with the 7-day grace
 *       window still open — chasing continues during grace),
 *   (b) customer authorization complete: authorized_at set AND
 *       setup.approved === true,
 *   (c) valid operational config + approved contacts:
 *       setup.config_valid === true AND setup.contacts_approved === true.
 *
 * This endpoint also runs applyRecoveryLifecycle() first, so expired grace
 * windows (-> "paused") and reached cancel dates (-> "canceled") are
 * reflected before evaluation.
 *
 * REAUTH (customer-side): when the customer changes approved contacts /
 * identity / templates / cadence, the setup endpoint sets reauth_required
 * and saves the new config without outreach running. Until the customer
 * re-approves, this endpoint reports ineligible with reason
 * "reauthorization_required" — that is what pauses affected outreach.
 */

import {
  getCustomer,
  getRecovery,
  recoveryEntitled,
  applyRecoveryLifecycle,
} from "../../../lib/customer.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requireIntakeKey(request, env) {
  const internalKey = env.INTAKE_INTERNAL_KEY;
  if (!internalKey) return false;
  const provided = request.headers.get("x-intake-key") || "";
  let diff = provided.length === internalKey.length ? 0 : 1;
  const n = Math.max(provided.length, internalKey.length);
  for (let i = 0; i < n; i++) {
    diff |= (provided.charCodeAt(i) || 0) ^ (internalKey.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!requireIntakeKey(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!env.ORDER_KV) return json({ ok: false, error: "not_configured" }, 500);

  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim();
  if (!email) return json({ ok: false, error: "missing_email" }, 400);

  const customer = await getCustomer(env, email);
  if (!customer) return json({ ok: false, error: "unknown_customer" }, 404);

  // Expire grace / apply scheduled cancels before evaluating.
  await applyRecoveryLifecycle(env, email);
  const rec = getRecovery(await getCustomer(env, email));

  const reasons = [];
  if (!recoveryEntitled({ recovery: rec })) {
    reasons.push(
      rec.entitlement === "none"
        ? "no_recovery_entitlement"
        : `entitlement_not_active: status=${rec.status}`
    );
  }
  const setup = rec.setup || {};
  if (!rec.authorized_at) reasons.push("authorization_incomplete: authorized_at not set");
  if (setup.approved !== true) reasons.push("setup_not_approved");
  if (setup.config_valid !== true) reasons.push("operational_config_invalid");
  if (setup.contacts_approved !== true) reasons.push("contacts_not_approved");
  if (rec.reauth_required === true) {
    reasons.push("reauthorization_required: contact/identity/template/cadence changed; outreach paused until the customer re-approves");
  }

  const eligible = reasons.length === 0;
  const allowanceRemaining = Math.max(0, (rec.allowance || 0) - (rec.requests_used || 0));

  return json({
    ok: true,
    eligible,
    reasons,
    entitlement: rec.entitlement,
    status: rec.status,
    allowance: rec.allowance,
    requests_used: rec.requests_used,
    allowance_remaining: allowanceRemaining,
    grace_until: rec.grace_until,
    billing_period_start: rec.billing_period_start,
    billing_period_end: rec.billing_period_end,
    authorized_at: rec.authorized_at,
    cancel_scheduled: rec.cancel_scheduled,
    service_end_at: rec.service_end_at,
  });
}
