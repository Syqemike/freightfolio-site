/**
 * POST /api/upload-complete — finalize a batch of uploads.
 *
 * The browser has PUT each file directly to the private bucket via presigned URLs.
 * It now reports what it uploaded; the server verifies everything before recording.
 *
 * Body (JSON):
 *   {
 *     "token": "<upload token>",
 *     "order_id": "<order id>",
 *     "uploads": [ { "sha256": "<64 hex>", "key": "orders/<order_id>/<sha256>/<file>" } ]
 *   }
 *
 * Server-side verification per file (never trusts the browser):
 *   - token signature + expiry + order scoping
 *   - key matches a reserved slot in order.pending for THIS order (prevents a
 *     client from claiming another order's objects)
 *   - HEAD (ranged GET) on the object: exists, size <= 25 MB
 *   - magic-byte check on the first 8 bytes: PDF / JPG / PNG only
 *   - sha256 segment of the key matches the reported hash
 *
 * On success the batch is recorded in order.files, the pending slots are cleared,
 * the order status moves to "received", and the customer + ops get notified.
 * Order of operations: storage verification first, KV write second, emails last.
 */

import { authorizeUpload } from "../../lib/upload-auth.js";
import { putOrder } from "../../lib/order-store.js";
import { headObject, putObject, verifyObjectMagicBytes } from "../../lib/storage.js";
import { sendFilesReceived, sendOpsFilesReceived } from "../../lib/notify.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file (must match upload-init.js)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.UPLOAD_TOKEN_SECRET || !env.ORDER_KV) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const auth = await authorizeUpload(env, request, {
    token: typeof body.token === "string" ? body.token : "",
    order_id: typeof body.order_id === "string" ? body.order_id : "",
  });
  if (auth.error) return auth.error;
  const { order, test } = auth;

  const uploads = Array.isArray(body.uploads) ? body.uploads : [];
  if (uploads.length === 0) return json({ ok: false, error: "no_uploads" }, 400);

  const pendingByKey = new Map(order.pending.map((p) => [p.key, p]));
  const accepted = [];
  const rejected = [];

  for (const u of uploads) {
    const key = typeof u.key === "string" ? u.key : "";
    const sha256 = typeof u.sha256 === "string" ? u.sha256.toLowerCase() : "";
    const rej = (reason) => rejected.push({ key: key || "(missing)", reason });

    const slot = pendingByKey.get(key);
    if (!slot) {
      rej("unreserved_key"); // key was never issued to this order — possible cross-order claim
      continue;
    }
    if (slot.sha256 !== sha256 || !/^[0-9a-f]{64}$/.test(sha256)) {
      rej("hash_mismatch");
      continue;
    }
    // Key structure must be exactly orders/<order_id>/<sha256>/<filename>.
    const keySha = key.split("/")[2];
    if (keySha !== sha256) {
      rej("key_hash_mismatch");
      continue;
    }

    let head;
    try {
      head = await headObject(env, key);
    } catch (e) {
      console.error("headObject failed", e);
      rej("storage_unavailable");
      continue;
    }
    if (!head.exists) {
      rej("object_missing");
      continue;
    }
    if (head.size !== null && head.size > MAX_FILE_BYTES) {
      rej("too_large");
      continue;
    }

    let magic;
    try {
      magic = await verifyObjectMagicBytes(env, key);
    } catch (e) {
      console.error("magic-byte check failed", e);
      rej("storage_unavailable");
      continue;
    }
    if (!magic.ok) {
      rej(magic.reason === "bad_magic_bytes" ? "bad_file_type" : "unreadable");
      continue;
    }

    accepted.push({
      sha256,
      filename: slot.filename,
      key,
      size_bytes: head.size,
      received_at: new Date().toISOString(),
      detected_type: magic.type,
    });
  }

  // Duplicate-content guard at finalize time (race-safe with the init-time check).
  const finalAccepted = [];
  const knownHashes = new Set(order.files.map((f) => f.sha256));
  for (const a of accepted) {
    if (knownHashes.has(a.sha256)) {
      rejected.push({ key: a.key, reason: "duplicate_content" });
      continue;
    }
    knownHashes.add(a.sha256);
    finalAccepted.push(a);
  }

  const acceptedKeys = new Set(finalAccepted.map((a) => a.key));
  const rejectedKeys = new Set(rejected.map((r) => r.key));
  order.pending = order.pending.filter((p) => !acceptedKeys.has(p.key) && !rejectedKeys.has(p.key));
  for (const a of finalAccepted) order.files.push(a);
  if (finalAccepted.length > 0) order.status = "received";
  await putOrder(env, order, { test });

  // Delivery addressing: the bridge's B2-fallback path has no Gmail/KV
  // access, so persist the customer email alongside the order in B2.
  if (finalAccepted.length > 0 && order.customer_email) {
    const metaKey = `orders/${order.order_id}/customer.json`;
    const metaBody = JSON.stringify({
      order_id: order.order_id,
      customer_email: order.customer_email,
      test: !!test,
      written_at: new Date().toISOString(),
    });
    const put = await putObject(env, metaKey, metaBody);
    if (!put.ok) console.error("customer.json write failed", put.error);
  }

  // Notifications last: storage + record are already durable.
  let emailStatus = "skipped";
  if (finalAccepted.length > 0 && !test) {
    const a = await sendFilesReceived(env, order, finalAccepted.length);
    const b = await sendOpsFilesReceived(env, order);
    emailStatus = a.ok && b.ok ? "sent" : "partial_failure";
    if (!a.ok) console.error("files-received email failed", a.error);
    if (!b.ok) console.error("ops files-received email failed", b.error);
  } else if (test) {
    emailStatus = "skipped_test_mode";
  }

  return json({
    ok: true,
    order_id: order.order_id,
    status: order.status,
    received: finalAccepted.length,
    total_files: order.files.length,
    allowance: order.doc_allowance,
    rejected,
    email: emailStatus,
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method not allowed", { status: 405 });
}
