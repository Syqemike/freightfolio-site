/**
 * POST /api/internal/recovery-admin
 *
 * Ops-only control plane for the recovery entitlement (same INTAKE_INTERNAL_KEY
 * guard, header "x-intake-key"). Never linked publicly.
 *
 * Actions (JSON body: { "action": "...", "email": "...", ... }):
 *   set_managed       — entitlement="managed_included", status="active"
 *                       (bundled into a managed-services engagement; the $99
 *                       charge must NEVER apply — the webhook rejects add-on
 *                       purchases for managed_included customers).
 *   clear_managed     — entitlement="none", status="canceled".
 *   set_authorization — { authorized_by, setup: {...} }: records
 *                       authorized_at=now; merges setup flags (approved,
 *                       config_valid, contacts_approved).
 *   clear_authorization — clears authorized_at + setup (re-auth required).
 *   set_status        — { status }: explicit ops status transition
 *                       (e.g. awaiting_setup -> active once setup is verified).
 *                       Must be a valid RECOVERY_STATUSES value.
 *
 * EVERY call is audit-logged to KV (recovery_audit:* records) with timestamp,
 * action, email, and actor. Audit records are append-only; this endpoint never
 * deletes them.
 */

import {
  getCustomer,
  getRecovery,
  setRecovery,
  newCustomerRecord,
  putCustomer,
  RECOVERY_STATUSES,
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

async function audit(env, entry) {
  if (!env.ORDER_KV) return;
  const key = `recovery_audit:${new Date().toISOString()}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  await env.ORDER_KV.put(key, JSON.stringify(entry));
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

  const action = typeof body.action === "string" ? body.action : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const actor = typeof body.actor === "string" ? body.actor : "ops";
  if (!action) return json({ ok: false, error: "missing_action" }, 400);
  if (!email) return json({ ok: false, error: "missing_email" }, 400);

  let customer = await getCustomer(env, email);
  if (!customer) {
    customer = newCustomerRecord(email);
    await putCustomer(env, customer);
  }
  const before = getRecovery(customer);
  const nowIso = new Date().toISOString();
  let patch = null;
  let detail = {};

  switch (action) {
    case "set_managed":
      patch = {
        entitlement: "managed_included",
        status: "active",
        stripe_addon_sub_id: null,
        grace_until: null,
        prior_status: null,
        cancel_scheduled: false,
        service_end_at: null,
        canceled_at: null,
        authorized_at: before.authorized_at || nowIso,
        authorized_by: before.authorized_by || `ops:${actor}`,
      };
      detail = { note: "managed service inclusion; add-on purchase blocked" };
      break;

    case "clear_managed":
      if (before.entitlement !== "managed_included") {
        return json({ ok: false, error: "not_managed" }, 409);
      }
      patch = { entitlement: "none", status: "canceled", canceled_at: nowIso };
      break;

    case "set_authorization": {
      const setupPatch =
        body.setup && typeof body.setup === "object" ? body.setup : {};
      patch = {
        authorized_at: nowIso,
        authorized_by:
          typeof body.authorized_by === "string" && body.authorized_by
            ? body.authorized_by
            : `ops:${actor}`,
        setup: { ...(before.setup || {}), ...setupPatch },
        reauth_required: false,
      };
      detail = { setup: patch.setup };
      break;
    }

    case "clear_authorization":
      patch = { authorized_at: null, authorized_by: null, setup: {}, reauth_required: true };
      break;

    case "set_status": {
      const status = typeof body.status === "string" ? body.status : "";
      if (!RECOVERY_STATUSES.includes(status)) {
        return json({ ok: false, error: "invalid_status" }, 400);
      }
      patch = { status };
      if (status === "canceled") patch.canceled_at = nowIso;
      detail = { from: before.status, to: status };
      break;
    }

    default:
      return json({ ok: false, error: "unknown_action" }, 400);
  }

  const next = await setRecovery(env, email, patch);
  await audit(env, {
    ts: nowIso,
    action,
    email,
    actor,
    detail,
    before: { entitlement: before.entitlement, status: before.status },
    after: { entitlement: next.entitlement, status: next.status },
  });

  return json({
    ok: true,
    action,
    email,
    entitlement: next.entitlement,
    status: next.status,
    authorized_at: next.authorized_at,
    audit: "logged",
  });
}
