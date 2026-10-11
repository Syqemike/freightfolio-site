/**
 * lib/notify.js — Resend transactional email for the intake flow.
 *
 * Three messages:
 *   (a) payment confirmed + private upload link (to the customer)
 *   (b) files received confirmation (to the customer)
 *   (c) internal ops notification: new paid order / files received (to ops inbox)
 *
 * The Resend API key comes ONLY from the RESEND_API_KEY environment variable.
 * It is never hardcoded, never committed, and never written to any file.
 *
 * Copy rules: professional Freightfolio tone, NO em dashes in customer-facing copy.
 */

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Freightfolio <hello@freightfolio.net>";

function opsInbox(env) {
  return env.OPS_NOTIFY_EMAIL || "hello@freightfolio.net";
}

export function uploadLinkFor(order, origin = "https://freightfolio.net") {
  const base = String(origin || "https://freightfolio.net").replace(/\/+$/, "");
  return `${base}/upload?t=${encodeURIComponent(order.upload_token)}`;
}

async function send(env, { to, subject, text, html, replyTo }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const payload = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    ...(html ? { html } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
  };
  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Resend request failed", e);
    return { ok: false, error: "send_failed" };
  }
  if (!res.ok) {
    console.error("Resend API error", res.status, await res.text().catch(() => ""));
    return { ok: false, error: "send_failed" };
  }
  return { ok: true };
}

/**
 * Magic-link sign-in email for the customer workspace.
 * Only ever sent to an address that has a paid order or active subscription
 * (verified by the caller against KV before calling this).
 */
export async function sendMagicLink(env, email, link) {
  const subject = "Your Freightfolio workspace sign-in link";
  const text = [
    "Hi,",
    "",
    "Here is your secure sign-in link for your Freightfolio workspace:",
    "",
    link,
    "",
    "This link expires in 15 minutes and can only be used once. If you did not request it, you can ignore this email.",
    "",
    "Your workspace is where you upload documents, track processing, and download your completed reports.",
    "",
    "Freightfolio",
    "Your loads, billed. Your money, sooner.",
  ].join("\n");
  return send(env, { to: email, subject, text, replyTo: "hello@freightfolio.net" });
}

/**
 * Workspace invitation for a brand-new customer (first order created).
 * Sent alongside the payment-confirmed email when the order is new.
 */
export async function sendWorkspaceInvite(env, email, origin = "https://freightfolio.net") {
  const base = String(origin || "https://freightfolio.net").replace(/\/+$/, "");
  const subject = "Your Freightfolio workspace is ready";
  const text = [
    "Hi,",
    "",
    "Your customer workspace is ready. It is the one place to upload documents, track processing, and download your completed reports.",
    "",
    "To sign in, go here and enter the email address you paid with. We will email you a secure sign-in link (no password to remember):",
    "",
    `${base}/login`,
    "",
    "You can also keep using the private upload link from your payment confirmation email. Both go to the same secure place.",
    "",
    "Freightfolio",
    "Your loads, billed. Your money, sooner.",
  ].join("\n");
  return send(env, { to: email, subject, text, replyTo: "hello@freightfolio.net" });
}
/**
 * (a) Payment confirmed + upload link. Sent when a verified $9.99 pilot payment
 * creates an order record.
 */
export async function sendPaymentConfirmed(env, order, origin) {
  const link = uploadLinkFor(order, origin);
  const subject = "Your Freightfolio mini-pilot is confirmed. Upload your documents here.";
  const text = [
    "Hi,",
    "",
    "Your $9.99 mini-pilot payment went through. Thank you.",
    "",
    "Next step: upload up to 10 freight documents (rate confirmations, BOLs, PODs, invoices) using your private link:",
    "",
    link,
    "",
    "Your link is valid for 7 days and works only for your order. Accepted formats: PDF, JPG, PNG (25 MB max per file).",
    "",
    "You also have a customer workspace at https://freightfolio.net/login where you can track processing and download your report. Sign in with this email address and we will send you a secure sign-in link.",
    "",
    "Once your files are in, we will process them and deliver your billing-readiness report within 3 to 5 business days.",
    "",
    "Questions? Just reply to this email.",
    "",
    "Freightfolio",
    "Your loads, billed. Your money, sooner.",
  ].join("\n");
  return send(env, { to: order.customer_email, subject, text, replyTo: "hello@freightfolio.net" });
}

/**
 * (b) Files received confirmation. Sent when upload-complete records the batch.
 */
export async function sendFilesReceived(env, order, fileCount) {
  const subject = `We received your ${fileCount} document${fileCount === 1 ? "" : "s"}. Your report is on its way.`;
  const text = [
    "Hi,",
    "",
    `We received ${fileCount} document${fileCount === 1 ? "" : "s"} for your mini-pilot order (${order.order_id}). Everything looks good on our end.`,
    "",
    "What happens next: our team reviews and processes your paperwork, then sends your billing-readiness report within 3 to 5 business days.",
    "",
    "If anything is missing or unreadable, we will email you before we start.",
    "",
    "Questions? Just reply to this email.",
    "",
    "Freightfolio",
    "Your loads, billed. Your money, sooner.",
  ].join("\n");
  return send(env, { to: order.customer_email, subject, text, replyTo: "hello@freightfolio.net" });
}

/**
 * (c) Internal ops notification. New paid order, or files received.
 * NOTE: as of this build, processing after storage is a MANUAL handoff
 * (the ops engine runs on an ephemeral VM). This email is the trigger a human
 * acts on. Do not describe this as automated processing anywhere customer-facing.
 */
export async function sendOpsNewOrder(env, order, origin) {
  const link = uploadLinkFor(order, origin);
  const subject = `[INTAKE] New paid mini-pilot order ${order.order_id}`;
  const text = [
    "New paid mini-pilot order. Manual handoff: watch for the files-received notification, then pull the files and run the pipeline.",
    "",
    `Order: ${order.order_id}`,
    `Email: ${order.customer_email}`,
    `Amount: $${(order.amount_cents / 100).toFixed(2)}`,
    `Allowance: ${order.doc_allowance} docs`,
    `Created: ${order.created_at}`,
    `Upload link sent to customer: ${link}`,
    `Storage prefix: ${order.storage_prefix}`,
    `Test order: ${order.test ? "YES (synthetic)" : "no"}`,
    "",
    "Next: when files arrive you will get a second notification with the file list.",
  ].join("\n");
  return send(env, { to: opsInbox(env), subject, text });
}

export async function sendOpsFilesReceived(env, order) {
  const lines = order.files.map(
    (f) => `- ${f.filename} (${f.size_bytes} bytes, sha256 ${String(f.sha256).slice(0, 12)}..., key ${f.key})`
  );
  const subject = `[INTAKE] Files received for ${order.order_id} (${order.files.length} docs)`;
  const text = [
    "Files received for a paid mini-pilot order. Manual handoff: download from the private bucket and run the ops pipeline.",
    "",
    `Order: ${order.order_id}`,
    `Email: ${order.customer_email}`,
    `Storage prefix: ${order.storage_prefix}`,
    `Test order: ${order.test ? "YES (synthetic)" : "no"}`,
    "",
    "Files:",
    ...lines,
    "",
    "Bucket/endpoint config: B2_ENDPOINT / B2_BUCKET in the Pages env. Use the ops application key; never share presigned URLs.",
  ].join("\n");
  return send(env, { to: opsInbox(env), subject, text });
}
