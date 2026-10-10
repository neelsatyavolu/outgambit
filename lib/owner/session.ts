import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { sign, verify } from "./crypto";

export const OWNER_COOKIE = "gambit_owner";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PREFIX = "owner.";

export function createSession(now: number): string {
  return sign(`${PREFIX}${now + SESSION_TTL_MS}`);
}

export function isValidSession(token: string | undefined, now: number): boolean {
  const value = verify(token);
  if (!value?.startsWith(PREFIX)) return false;
  const expiresAt = Number(value.slice(PREFIX.length));
  return Number.isFinite(expiresAt) && now < expiresAt;
}

const digest = (text: string): Buffer => createHash("sha256").update(text).digest();

/** Constant-time comparison against OWNER_PASSWORD. */
export function checkPassword(input: string): boolean {
  return timingSafeEqual(digest(input), digest(env().OWNER_PASSWORD));
}
