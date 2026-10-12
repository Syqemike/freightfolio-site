/**
 * POST /api/issues/dismiss — customer dismisses an issue.
 * Body: { order_id, created_at, type }. Marks the matching issue as dismissed
 * on the order record. Dismissed issues are hidden from the Issues tab.
 */
import { json, requireSession } from "../../../../lib/api-auth.js";
import { listCustomerOrders } from "../../../../lib/customer.js";
import { putOrder } from "../../../../lib/order-store.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  const body = await request.json().catch(() => ({}));
  const { order_id, issue_idx, created_at, type } = body;
  if (!order_id) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const orders = await listCustomerOrders(env, session.email);
  const order = orders.find((o) => o.order_id === order_id);
  if (!order) return json({ ok: false, error: "order_not_found" }, 404);

  const issues = order.issues || [];
  let idx = -1;

  // New format: direct index
  if (issue_idx !== undefined && issue_idx !== null) {
    const parsed = parseInt(issue_idx, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed < issues.length) {
      idx = parsed;
    }
  }
  // Old format: match by type + created_at (for cached frontends)
  if (idx === -1 && created_at && type) {
    idx = issues.findIndex((i) => i.type === type && i.created_at === created_at && !i.dismissed);
  }

  if (idx === -1) {
    return json({ ok: false, error: "issue_not_found" }, 404);
  }
  const issue = issues[idx];
  if (issue.dismissed) return json({ ok: false, error: "already_dismissed" }, 400);

  issue.dismissed = true;
  issue.dismissed_at = new Date().toISOString();

  // Save to the correct KV key — test orders live under the test: prefix.
  // order.test should be set, but fall back to checking both locations.
  let saved = false;
  if (order.test === true) {
    await putOrder(env, order, { test: true });
    saved = true;
  } else if (order.test === false) {
    await putOrder(env, order, { test: false });
    saved = true;
  } else {
    // test flag missing — try test mode first, then production
    const { getOrder } = await import("../../../../lib/order-store.js");
    const testVersion = await getOrder(env, order.order_id, { test: true });
    if (testVersion) {
      await putOrder(env, order, { test: true });
    } else {
      await putOrder(env, order, { test: false });
    }
    saved = true;
  }

  return json({ ok: true });
}
