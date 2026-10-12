/**
 * lib/password.js — PBKDF2 password hashing for Cloudflare Workers.
 * Uses Web Crypto API (available in Workers/Pages Functions).
 */

const ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 16;

/**
 * Generate a random salt (base64).
 */
export function generateSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return btoa(String.fromCharCode(...salt));
}

/**
 * Hash a password with PBKDF2-SHA256.
 * Returns { hash, salt } where both are base64 strings.
 */
export async function hashPassword(password, saltB64 = null) {
  const saltB64Final = saltB64 || generateSalt();
  const saltBytes = Uint8Array.from(atob(saltB64Final), c => c.charCodeAt(0));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  const hashBytes = new Uint8Array(derivedBits);
  const hashB64 = btoa(String.fromCharCode(...hashBytes));

  return { hash: hashB64, salt: saltB64Final };
}

/**
 * Verify a password against stored hash and salt.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyPassword(password, storedHashB64, storedSaltB64) {
  const { hash } = await hashPassword(password, storedSaltB64);
  return constantTimeEqual(hash, storedHashB64);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
