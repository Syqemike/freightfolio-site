/**
 * POST /api/internal/recovery-usage-sync
 *
 * The recovery engine (ops VM worker) pushes usage for a customer:
 *   { "email": "...", "period_start": "<ISO or unix seconds>",
 *     "period_end": "<ISO or unix seconds, optional>",
 *     "requests_used": 12, "overage_units": 0 }
 *
 * Guarded by INTAKE_INTERNAL_KEY (header "x-intake-key", constant-time
 * compare). Never linked publicly.
 *
 * Semantics:
 *   - IDEMPOTENT: pushing the same values twice is a no-op.
 *   - MONOTONIC: counters never decrease. A push lower than the stored
 *     value is clamped to the stored value (reported as clamped:true).
 *   - PERIOD ADVANCE: when period_start is later than the stored
 *     billing_period_start, the counters reset to the pushed values (new
 *     billing month). Stripe-driven resets via invoice.paid take precedence
 *     and use the same rule.
 *   - Runs applyRecoveryLifecycle() first so expired grace / scheduled
 *     cancels are reflected.
 */

import {
  getCustomer,
  getRecovery,
  setRecovery,
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

function toIso(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v * 1000).toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function toNonNegInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireIntakeKey(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!env.ORDER_KV) return json({ ok: false, error: "not_configured" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return json({ ok: false, error: "missing_email" }, 400);

  const customer = await getCustomer(env, email);
  if (!customer) return json({ ok: false, error: "unknown_customer" }, 404);
  const rec = getRecovery(customer);
  if (rec.entitlement !== "addon" && rec.entitlement !== "managed_included") {
    return json({ ok: false, error: "no_recovery_entitlement" }, 409);
  }

  await applyRecoveryLifecycle(env, email);
  const current = getRecovery(await getCustomer(env, email));

  const periodStartIso = toIso(body.period_start);
  const periodEndIso = toIso(body.period_end);
  const patch = {};
  let periodAdvanced = false;
  if (periodStartIso && (!current.billing_period_start || periodStartIso > current.billing_period_start)) {
    patch.billing_period_start = periodStartIso;
    periodAdvanced = true;
  }
  if (periodEndIso && (!current.billing_period_end || periodEndIso > current.billing_period_end)) {
    patch.billing_period_end = periodEndIso;
  }

  // Monotonic counters: within a period they only grow; a period advance
  // resets the baseline to the pushed values.
  const pushedUsed = toNonNegInt(body.requests_used, 0);
  const pushedOver = toNonNegInt(body.overage_units, 0);
  const baseUsed = periodAdvanced ? 0 : current.requests_used || 0;
  const baseOver = periodAdvanced ? 0 : current.overage_units || 0;
  const requestsUsed = Math.max(baseUsed, pushedUsed);
  const overageUnits = Math.max(baseOver, pushedOver);
  const clamped =
    (!periodAdvanced && (pushedUsed < baseUsed || pushedOver < baseOver)) || false;

  const next = await setRecovery(env, email, {
    ...patch,
    requests_used: requestsUsed,
    overage_units: overageUnits,
  });

  return json({
    ok: true,
    email: next.email || email,
    period_advanced: periodAdvanced,
    requests_used: next.requests_used,
    overage_units: next.overage_units,
    allowance: next.allowance,
    allowance_remaining: Math.max(0, (next.allowance || 0) - next.requests_used),
    overage_cap_cents: next.overage_cap_cents,
    clamped,
    status: next.status,
  });
}
