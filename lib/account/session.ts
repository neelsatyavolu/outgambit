import "server-only";
import { isPlayerId } from "../http";
import { sign, verify } from "../owner/crypto";

export const ACCOUNT_COOKIE = "gambit_account";
export const ACCOUNT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PREFIX = "account.";

/**
 * The player id an account's games are kept under. It is deliberately not a
 * UUID: the anonymous-id cookie is unsigned and accepts only UUIDs, so no
 * cookie value can name an account's games without a signed session.
 */
export const accountPlayerId = (userId: string): string => `account:${userId}`;

export function createAccountSession(userId: string, now: number): string {
  return sign(`${PREFIX}${userId}.${now + ACCOUNT_TTL_MS}`);
}

/** The user a session names, or null if it is forged, expired or not an account session. */
export function accountOf(token: string | undefined, now: number): string | null {
  const value = verify(token);
  if (!value?.startsWith(PREFIX)) return null;
  const [userId, expires] = value.slice(PREFIX.length).split(".");
  const expiresAt = Number(expires);
  return isPlayerId(userId) && Number.isFinite(expiresAt) && now < expiresAt ? userId : null;
}
