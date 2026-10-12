/**
 * POST /api/recovery/resume — customer resumes paused recovery outreach.
 *
 * Session-authed ONLY; operates on the caller's own customer record.
 * Restores the status captured at pause time (paused_from); when that
 * is missing or no longer valid, resumes to "active". Resuming while a
 * reauthorization is pending is rejected — re-approve the setup first.
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
  if (rec.status !== "paused") {
    return json({ ok: false, error: "not_paused", detail: `status=${rec.status}` }, 409);
  }
  if (rec.reauth_required === true) {
    return json(
      { ok: false, error: "reauthorization_required", detail: "Re-approve the recovery setup before resuming." },
      409
    );
  }

  const restore = ["active", "grace", "past_due", "awaiting_setup"].includes(rec.paused_from)
    ? rec.paused_from
    : "active";
  const next = await setRecovery(env, email, {
    status: restore,
    paused_from: null,
  });
  await auditRecovery(env, {
    action: "customer_resume",
    email,
    actor: `customer:${email}`,
    detail: { from: "paused", to: restore },
  });
  return json({ ok: true, email, status: restore, recovery: recoverySummary(next) });
}
