import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCHEME = "scrypt";
// OWASP's floor for scrypt. The cost is stored with each hash, so raising it
// later leaves existing passwords checkable.
const COST = { N: 2 ** 15, r: 8, p: 3 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

type Cost = { N: number; r: number; p: number };

function derive(password: string, salt: Buffer, length: number, cost: Cost): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, length, { ...cost, maxmem: MAX_MEMORY_BYTES }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** A salted, slow hash of the password, safe to store. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, COST);
  return [SCHEME, COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** True when `password` is the one `stored` was made from. Never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== SCHEME || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  // A shorter key would be easier to match, and an empty one would match anything.
  if (expected.length !== KEY_BYTES) return false;
  try {
    const cost = { N: Number(n), r: Number(r), p: Number(p) };
    const given = await derive(password, Buffer.from(salt, "base64url"), KEY_BYTES, cost);
    return timingSafeEqual(given, expected);
  } catch {
    // The stored cost is not one scrypt accepts, so this was never one of our hashes.
    return false;
  }
}
