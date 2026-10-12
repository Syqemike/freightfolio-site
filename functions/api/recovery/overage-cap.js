/**
 * POST /api/recovery/overage-cap — customer sets the monthly overage
 * spending cap. Body: { "overage_cap_cents": <non-negative integer> }.
 *
 * Session-authed ONLY; operates on the caller's own customer record.
 *
 * RULES (mirror the add-on contract):
 *   - The cap may be raised, lowered, or disabled (0 = overage blocked).
 *   - It can NEVER be set below what is already incurred:
 *     incurred_cents = overage_units * $2.00. Lowering the cap only affects
 *     FUTURE requests; charges already on the books stand.
 *   - The VM metering side picks the cap up through the usage-sync cycle
 *     (sync_runner refreshes ledger terms from the site entitlement before
 *     building the payload).
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
  OVERAGE_CENTS_PER_UNIT,
} from "../../../lib/recovery-api.js";

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
  const proposed = Number(body && body.overage_cap_cents);
  if (!Number.isFinite(proposed) || proposed < 0 || Math.floor(proposed) !== proposed) {
    return json({ ok: false, error: "invalid_cap", detail: "overage_cap_cents must be a non-negative integer (cents)." }, 400);
  }

  const incurredCents = (rec.overage_units || 0) * OVERAGE_CENTS_PER_UNIT;
  if (proposed < incurredCents) {
    return json(
      {
        ok: false,
        error: "cap_below_incurred",
        detail: `The cap cannot go below $${(incurredCents / 100).toFixed(2)} already incurred this period (${rec.overage_units || 0} overage requests).`,
        overage_units: rec.overage_units || 0,
        incurred_cents: incurredCents,
      },
      409
    );
  }

  const before = rec.overage_cap_cents || 0;
  const next = await setRecovery(env, email, { overage_cap_cents: proposed });
  await auditRecovery(env, {
    action: "customer_overage_cap",
    email,
    actor: `customer:${email}`,
    detail: { from_cents: before, to_cents: proposed },
  });

  const note =
    proposed < before
      ? "Lowered. The new cap applies to future requests only; charges already incurred are unchanged."
      : proposed === 0
        ? "Overage disabled. Requests beyond the 50/month allowance wait in the queue instead of billing."
        : "Raised. Up to this amount per month may be billed at $2.00 per extra request.";

  return json({
    ok: true,
    email,
    overage_cap_cents: proposed,
    incurred_cents: incurredCents,
    note,
    recovery: recoverySummary(next),
  });
}
