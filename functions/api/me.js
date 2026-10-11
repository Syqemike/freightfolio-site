/**
 * GET /api/me — workspace overview for the signed-in customer.
 *
 * Returns the active entitlement (pilot order or subscription + current period
 * order), allowance vs used, recent uploads, batches awaiting processing,
 * completed reports, and issues needing attention.
 *
 * For active subscriptions this lazily creates the current period order
 * (product "subscription") so uploads have a container.
 */

import { json, requireSession } from "../../lib/api-auth.js";
import {
  getCustomer,
  listCustomerOrders,
  currentUploadOrder,
  activeSubscription,
  docsUsed,
  PLANS,
} from "../../lib/customer.js";

function orderSummary(o) {
  return {
    order_id: o.order_id,
    product: o.product,
    plan: o.plan || null,
    status: o.status,
    created_at: o.created_at,
    delivered_at: o.delivered_at || null,
    allowance: o.doc_allowance,
    used: docsUsed(o),
    files: (o.files || []).slice(-5).map((f) => ({
      filename: f.filename,
      size_bytes: f.size_bytes,
      received_at: f.received_at,
    })),
    reports: (o.report_files || []).map((r) => ({ name: r.name, uploaded_at: r.uploaded_at })),
    issues: (o.issues || []).length,
    issues_high: (o.issues || []).filter((i) => i.severity === "high").length,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  const customer = await getCustomer(env, session.email);
  if (!customer) {
    return json({ ok: false, error: "no_customer" }, 404);
  }

  const { order: currentOrder, kind } = await currentUploadOrder(env, session.email);
  const orders = await listCustomerOrders(env, session.email);

  const sub = customer.subscription;
  const planInfo = sub && activeSubscription(sub)
    ? {
        kind: "subscription",
        plan: sub.plan,
        plan_name: PLANS[sub.plan] ? PLANS[sub.plan].name : sub.plan,
        status: sub.status,
        allowance: sub.allowance,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
      }
    : null;

  const pilot = orders.find((o) => o.product === "mini-pilot") || null;

  const awaiting = orders.filter((o) => ["received", "processing"].includes(o.status)).length;
  const completedReports = orders.reduce((n, o) => n + (o.report_files || []).length, 0);
  const openIssues = orders.reduce(
    (n, o) => n + (o.issues || []).filter((i) => i.severity !== "low").length,
    0
  );

  return json({
    ok: true,
    email: session.email,
    role: session.role,
    entitlement: planInfo || (pilot ? {
      kind: "pilot",
      plan: "mini-pilot",
      plan_name: "Mini-pilot",
      status: pilot.status,
      allowance: pilot.doc_allowance,
    } : null),
    current_order: currentOrder
      ? {
          order_id: currentOrder.order_id,
          kind,
          allowance: currentOrder.doc_allowance,
          used: docsUsed(currentOrder),
          remaining: Math.max(0, currentOrder.doc_allowance - docsUsed(currentOrder)),
          status: currentOrder.status,
        }
      : null,
    stats: {
      awaiting_processing: awaiting,
      completed_reports: completedReports,
      open_issues: openIssues,
    },
    orders: orders.map(orderSummary),
  });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
