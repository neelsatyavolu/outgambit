import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { sign, verify } from "./crypto";

export const OWNER_COOKIE = "gambit_owner";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PREFIX = "owner.";

// Sessions carry a keyed fingerprint of the password they were issued under,
// so changing OWNER_PASSWORD signs every existing session out.
const fingerprint = (password: string): string => sign(`password:${password}`).split(".").at(-1)!.slice(0, 22);

export function createSession(now: number, password: string = env().OWNER_PASSWORD): string {
  return sign(`${PREFIX}${now + SESSION_TTL_MS}.${fingerprint(password)}`);
}

export function isValidSession(
  token: string | undefined,
  now: number,
  password: string = env().OWNER_PASSWORD,
): boolean {
  const value = verify(token);
  if (!value?.startsWith(PREFIX)) return false;
  const [expires, issuedUnder] = value.slice(PREFIX.length).split(".");
  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && now < expiresAt && issuedUnder === fingerprint(password);
}

const digest = (text: string): Buffer => createHash("sha256").update(text).digest();

/** Constant-time comparison against OWNER_PASSWORD. */
export function checkPassword(input: string): boolean {
  return timingSafeEqual(digest(input), digest(env().OWNER_PASSWORD));
}
