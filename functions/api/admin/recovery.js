/**
 * GET /api/admin/recovery — ops read view for the recovery add-on.
 *
 * Admin session ONLY (requireAdmin: freightfolio.ops@gmail.com).
 * Read-only: the write path is POST /api/internal/recovery-admin (intake
 * key), listed here for reference.
 *
 * Response (the contract js/admin.js renders):
 *   { ok, entitlements: [{email, entitlement, status, requests_used,
 *     requests_remaining, allowance,
 *     reauth_required, authorized_at, grace_until, cancel_scheduled,
 *     service_end_at, billing_period_end}],
 *     exceptions: [], audit: [{at, actor, action, detail}] }
 *
 * exceptions is empty by design: engine-side chase exceptions live in the
 * recovery engine state on the ops VM, not on the site. It is returned as
 * a stable empty array so the ops console always has the field.
 */

import { json, requireAdmin } from "../../../lib/api-auth.js";
import { getRecovery } from "../../../lib/customer.js";

const AUDIT_LIMIT = 100;

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  if (!env.ORDER_KV) return json({ ok: false, error: "not_configured" }, 500);

  const ents = [];
  const listed = await env.ORDER_KV.list({ prefix: "customer:" });
  for (const { name } of listed.keys) {
    let raw;
    try {
      raw = await env.ORDER_KV.get(name);
    } catch {
      continue;
    }
    if (!raw) continue;
    let customer;
    try {
      customer = JSON.parse(raw);
    } catch {
      continue;
    }
    const rec = getRecovery(customer);
    if (rec.entitlement === "none") continue;
    const used = rec.requests_used || 0;
    const allowance = rec.allowance || 50;
    ents.push({
      email: customer.email || null,
      entitlement: rec.entitlement,
      status: rec.status,
      requests_used: used,
      requests_remaining: Math.max(0, allowance - used),
      allowance,
      reauth_required: rec.reauth_required === true,
      authorized_at: rec.authorized_at,
      authorized_by: rec.authorized_by,
      grace_until: rec.grace_until,
      cancel_scheduled: rec.cancel_scheduled === true,
      service_end_at: rec.service_end_at,
      billing_period_start: rec.billing_period_start,
      billing_period_end: rec.billing_period_end,
      stripe_addon_sub_id: rec.stripe_addon_sub_id,
      updated_at: rec.updated_at,
    });
  }
  ents.sort((a, b) => String(a.email).localeCompare(String(b.email)));

  // Latest audit records, newest first (same recovery_audit:* keys the
  // internal admin endpoint writes, plus customer self-serve actions).
  const audit = [];
  const auditListed = await env.ORDER_KV.list({ prefix: "recovery_audit:" });
  const names = auditListed.keys.map((k) => k.name).sort().reverse().slice(0, AUDIT_LIMIT);
  for (const name of names) {
    let raw;
    try {
      raw = await env.ORDER_KV.get(name);
    } catch {
      continue;
    }
    if (!raw) continue;
    try {
      const e = JSON.parse(raw);
      audit.push({
        at: e.ts || null,
        actor: e.actor || null,
        action: e.action || null,
        email: e.email || null,
        detail: e.detail ? JSON.stringify(e.detail) : null,
      });
    } catch {
      continue;
    }
  }

  return json({
    ok: true,
    entitlements: ents,
    exceptions: [],
    audit,
    write_path: "POST /api/internal/recovery-admin (x-intake-key)",
  });
}
