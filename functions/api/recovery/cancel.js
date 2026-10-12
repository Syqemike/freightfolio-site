/**
 * POST /api/recovery/cancel — customer cancels the Recovery add-on.
 * Body: { "at_period_end": true } (default) or { "at_period_end": false }.
 *
 * Session-authed ONLY; operates on the caller's own customer record.
 *
 * STRIPE REALITY (no server-side Stripe key exists): this endpoint cannot
 * touch the Stripe subscription. It records the customer's intent
 * site-side:
 *   - at_period_end (default): service continues until billing_period_end
 *     (cancel_scheduled=true, status stays active) — mirrors the billing
 *     workstream's cancel-at-period-end semantics.
 *   - immediate: status -> "canceled" now (same as cancelRecoveryAddon).
 * In BOTH cases ops must cancel the Stripe subscription in the dashboard;
 * the response says so explicitly (manual_stripe_action) so the customer
 * is never billed for a service they canceled here.
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

const MANUAL_STRIPE_ACTION =
  "Stripe has no server-side key for this project yet, so the subscription " +
  "must also be canceled in the Stripe dashboard by ops. If that step is " +
  "missed, the customer is still billed at renewal.";

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
  if (rec.entitlement === "managed_included") {
    return json({ ok: false, error: "managed_included", detail: "Recovery is bundled into your managed billing; contact hello@freightfolio.net to change it." }, 409);
  }
  if (rec.status === "canceled") {
    return json({ ok: false, error: "already_canceled" }, 409);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const atPeriodEnd = body.at_period_end !== false;
  const nowIso = new Date().toISOString();

  let next;
  let action;
  if (atPeriodEnd) {
    const serviceEnd =
      rec.billing_period_end && new Date(rec.billing_period_end).getTime() > Date.now()
        ? rec.billing_period_end
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    next = await setRecovery(env, email, {
      cancel_scheduled: true,
      service_end_at: serviceEnd,
    });
    action = "customer_cancel_scheduled";
  } else {
    next = await setRecovery(env, email, {
      status: "canceled",
      canceled_at: nowIso,
      cancel_scheduled: false,
      grace_until: null,
      prior_status: null,
      service_end_at: nowIso,
    });
    action = "customer_cancel_immediate";
  }
  await auditRecovery(env, {
    action,
    email,
    actor: `customer:${email}`,
    detail: { at_period_end: atPeriodEnd, service_end_at: next.service_end_at },
  });

  return json({
    ok: true,
    email,
    status: next.status,
    cancel_scheduled: next.cancel_scheduled === true,
    service_end_at: next.service_end_at,
    manual_stripe_action: MANUAL_STRIPE_ACTION,
    recovery: recoverySummary(next),
  });
}
