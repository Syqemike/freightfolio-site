/**
 * lib/recovery-api.js — shared server-side helpers for the customer-facing
 * recovery add-on endpoints (/api/recovery/*) and the admin read endpoint.
 *
 * CUSTOMER ISOLATION RULE (all /api/recovery/* endpoints):
 * the customer identity ALWAYS comes from the verified session
 * (requireSession). Request bodies must NEVER carry an email; any "email"
 * field in a body is ignored.
 *
 * Re-exported audit log format matches
 * functions/api/internal/recovery-admin.js (recovery_audit:* keys).
 */

import { getRecovery } from "./customer.js";
import { RECOVERY_ADDON } from "./recovery-entitlements.js";

/** Append-only audit record for a recovery action. */
export async function auditRecovery(env, { action, email, actor, detail }) {
  if (!env.ORDER_KV) return;
  const key = `recovery_audit:${new Date().toISOString()}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  await env.ORDER_KV.put(
    key,
    JSON.stringify({
      ts: new Date().toISOString(),
      action,
      email,
      actor,
      detail: detail || {},
    }),
    // RC-06 (audit 2026-10-12): 90-day TTL so audit keys cannot grow unbounded.
    { expirationTtl: 90 * 24 * 60 * 60 }
  );
}

/**
 * Public-safe recovery summary for /api/me and admin reads. Shape matches
 * what js/recovery-addon.js normalizeRecovery() expects (plus a few extra
 * operational fields that are passed through):
 *   { entitlement, status, allowance, requests_used, requests_remaining,
 *     setup, reauth_required, since, next_period_start,
 *     authorized_at, cancel_scheduled, service_end_at, grace_until }
 */
export function recoverySummary(rec) {
  const r = getRecovery({ recovery: rec });
  const allowance = r.allowance || 50;
  const requestsUsed = r.requests_used || 0;
  return {
    entitlement: r.entitlement,
    status: r.status,
    allowance,
    requests_used: requestsUsed,
    requests_remaining: Math.max(0, allowance - requestsUsed),
    setup: r.setup || {},
    reauth_required: r.reauth_required === true,
    reauth_pending_since: r.reauth_pending_since || null,
    since: r.billing_period_start || r.authorized_at || r.updated_at,
    next_period_start: r.billing_period_end,
    authorized_at: r.authorized_at,
    authorized_by: r.authorized_by,
    cancel_scheduled: r.cancel_scheduled === true,
    service_end_at: r.service_end_at,
    grace_until: r.grace_until,
    billing_period_start: r.billing_period_start,
    billing_period_end: r.billing_period_end,
  };
}

/** True when the customer may use the self-serve recovery endpoints. */
export function recoverySelfServeAllowed(rec) {
  const r = getRecovery({ recovery: rec });
  return r.entitlement === "addon" || r.entitlement === "managed_included";
}

/** Guard the $99 config from drifting out of sync with the billing core. */
export function addonTerms() {
  return {
    price_id: RECOVERY_ADDON.priceId,
    amount_cents: RECOVERY_ADDON.amountCents,
    monthly_allowance: RECOVERY_ADDON.monthlyAllowance,
  };
}
