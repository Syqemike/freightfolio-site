/**
 * Storage tests: magic-byte detection, safe filenames, key scheme, presign shape.
 * Synthetic only; presigning is pure crypto (no network calls).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectFileType,
  safeFilename,
  objectKeyFor,
  presignedPutUrl,
  presignedGetUrl,
  sha256HexOfBytes,
} from "../lib/storage.js";
import { mockEnv } from "./helpers.js";

const ORDER = "ord_" + "c".repeat(32);
const SHA = "d".repeat(64);

function bytes(arr) {
  return new Uint8Array(arr);
}

describe("magic-byte file type detection", () => {
  it("detects a valid PDF", () => {
    assert.equal(detectFileType(bytes([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])), "pdf");
  });

  it("detects a valid PNG", () => {
    assert.equal(detectFileType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
  });

  it("detects a valid JPG", () => {
    assert.equal(detectFileType(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])), "jpg");
  });

  it("rejects a renamed .exe (MZ header with .pdf name)", () => {
    // An .exe renamed to .pdf: magic bytes are what matter, not the name.
    assert.equal(detectFileType(bytes([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])), null);
  });

  it("rejects random bytes and empty input", () => {
    assert.equal(detectFileType(bytes([0x00, 0x01, 0x02, 0x03])), null);
    assert.equal(detectFileType(bytes([])), null);
  });

  it("rejects a truncated PDF header", () => {
    assert.equal(detectFileType(bytes([0x25, 0x50, 0x44])), null);
  });
});

describe("filename safety and key scheme", () => {
  it("strips path traversal from filenames", () => {
    const safe = safeFilename("../../etc/passwd.pdf");
    assert.ok(!safe.includes("/"), safe);
    assert.ok(!safe.includes(".."), safe);
  });

  it("strips backslash paths and control characters", () => {
    const safe = safeFilename("C:\\Users\\x\\evil.pdf");
    assert.ok(!safe.includes("\\"), safe);
  });

  it("builds the orders/<order_id>/<sha256>/<safe-filename> key", () => {
    const key = objectKeyFor(ORDER, SHA, "Rate Confirmation.pdf");
    assert.equal(key, `orders/${ORDER}/${SHA}/Rate_Confirmation.pdf`);
  });

  it("rejects malformed order ids and hashes in key building", () => {
    assert.throws(() => objectKeyFor("nope", SHA, "a.pdf"), /bad order id/);
    assert.throws(() => objectKeyFor(ORDER, "xyz", "a.pdf"), /bad sha256/);
  });
});

describe("presigned URL generation", () => {
  it("mints a PUT URL with SigV4 query auth", async () => {
    const env = mockEnv();
    const url = await presignedPutUrl(env, {
      key: `orders/${ORDER}/${SHA}/doc.pdf`,
      contentType: "application/pdf",
    });
    const u = new URL(url);
    assert.ok(url.startsWith("https://s3.us-west-004.backblazeb2.com/test-intake-bucket/"));
    assert.equal(u.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(u.searchParams.get("X-Amz-Expires"), "300");
    assert.ok((u.searchParams.get("X-Amz-Signature") || "").length === 64);
    assert.ok(u.searchParams.get("X-Amz-SignedHeaders").includes("content-type"));
  });

  it("mints a GET URL with 15-minute expiry and host-only signed headers", async () => {
    const env = mockEnv();
    const url = await presignedGetUrl(env, { key: `orders/${ORDER}/${SHA}/doc.pdf` });
    const u = new URL(url);
    assert.equal(u.searchParams.get("X-Amz-Expires"), "900");
    assert.equal(u.searchParams.get("X-Amz-SignedHeaders"), "host");
  });

  it("refuses keys outside orders/<order_id>/", async () => {
    const env = mockEnv();
    await assert.rejects(
      presignedPutUrl(env, { key: "evil/key.pdf", contentType: "application/pdf" }),
      /orders\/<order_id>/
    );
    await assert.rejects(presignedGetUrl(env, { key: "evil/key.pdf" }), /orders\/<order_id>/);
  });

  it("fails clearly when storage env is missing", async () => {
    const env = mockEnv({ B2_KEY_SECRET: "" });
    await assert.rejects(
      presignedPutUrl(env, { key: `orders/${ORDER}/${SHA}/a.pdf`, contentType: "application/pdf" }),
      /not configured/
    );
  });

  it("sha256 of bytes matches the known digest", async () => {
    const h = await sha256HexOfBytes(new TextEncoder().encode("hello"));
    assert.equal(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
