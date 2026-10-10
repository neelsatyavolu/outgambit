import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const key = (): Buffer => Buffer.from(env().SECRETS_KEY, "base64");
// A separate key for signatures, derived from the encryption key.
const signingKey = (): Buffer => createHmac("sha256", key()).update("gambit-signing").digest();

/** AES-256-GCM. The result is safe to store or put in a cookie. */
export function encrypt(text: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** Throws if the blob was not produced by `encrypt` with this key. */
export function decrypt(blob: string): string {
  const [version, payload] = blob.split(".");
  if (version !== VERSION || !payload) throw new Error("Unreadable secret");
  const raw = Buffer.from(payload, "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Unreadable secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

const mac = (value: string): Buffer => createHmac("sha256", signingKey()).update(value).digest();

export function sign(value: string): string {
  return `${value}.${mac(value).toString("base64url")}`;
}

/** Returns the signed value, or null if the signature does not match. */
export function verify(token: string | undefined): string | null {
  if (!token) return null;
  const cut = token.lastIndexOf(".");
  if (cut <= 0) return null;
  const value = token.slice(0, cut);
  const given = Buffer.from(token.slice(cut + 1), "base64url");
  const expected = mac(value);
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}
