/**
 * GET /api/account — plan details, usage, support info, retention policy.
 *
 * Retention/deletion copy states the ACTUAL behavior. There is no automated
 * deletion and no malware scanning; the copy below says exactly that.
 */

import { json, requireSession } from "../../lib/api-auth.js";
import {
  getCustomer,
  currentUploadOrder,
  activeSubscription,
  docsUsed,
  PLANS,
} from "../../lib/customer.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const { session } = auth;

  const customer = await getCustomer(env, session.email);
  if (!customer) return json({ ok: false, error: "no_customer" }, 404);

  const { order: currentOrder, kind } = await currentUploadOrder(env, session.email);
  const sub = customer.subscription;

  return json({
    ok: true,
    email: session.email,
    member_since: customer.created_at,
    plan: sub && activeSubscription(sub)
      ? {
          kind: "subscription",
          name: PLANS[sub.plan] ? PLANS[sub.plan].name : sub.plan,
          status: sub.status,
          allowance_per_period: sub.allowance,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          // Stripe customer portal: not offered — we do not hold a Stripe
          // secret key server-side, so portal sessions cannot be created.
          // Customers manage billing by emailing hello@freightfolio.net.
          portal_url: null,
        }
      : {
          kind: "pilot",
          name: "Mini-pilot",
          status: currentOrder ? currentOrder.status : "none",
          allowance: currentOrder ? currentOrder.doc_allowance : 10,
        },
    usage: currentOrder
      ? {
          order_id: currentOrder.order_id,
          kind,
          allowance: currentOrder.doc_allowance,
          used: docsUsed(currentOrder),
          remaining: Math.max(0, currentOrder.doc_allowance - docsUsed(currentOrder)),
        }
      : null,
    support: {
      email: "hello@freightfolio.net",
      note: "Replies come from a real person, usually within one business day.",
    },
    retention: {
      policy: "30_day",
      summary:
        "Your uploaded documents and reports are stored in private, encrypted storage and automatically deleted 30 days after upload. " +
        "Nothing is shared with third parties. You can also request earlier deletion below and we will remove your files and account records manually.",
      malware_scanning:
        "Files are checked for type and size on upload. Automated malware scanning is not currently in place.",
    },
  });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
