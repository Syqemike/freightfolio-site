/**
 * POST /api/recovery/pause — customer pauses all recovery outreach.
 *
 * Session-authed ONLY; operates on the caller's own customer record
 * (identity from the session, never from the body). Pausing stops the
 * engine (recoveryEntitled() is false for "paused") but keeps billing
 * intact — this is NOT a cancel.
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

const PAUSABLE = ["active", "grace", "past_due"];

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
  if (!PAUSABLE.includes(rec.status)) {
    return json({ ok: false, error: "not_pausable", detail: `status=${rec.status}` }, 409);
  }

  const next = await setRecovery(env, email, {
    status: "paused",
    paused_from: rec.status,
  });
  await auditRecovery(env, {
    action: "customer_pause",
    email,
    actor: `customer:${email}`,
    detail: { from: rec.status, to: "paused" },
  });
  return json({ ok: true, email, status: "paused", recovery: recoverySummary(next) });
}
