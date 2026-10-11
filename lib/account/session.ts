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

const ACCOUNT_PLAYER_PREFIX = "account:";

/** The user behind a player id, or null when it is a guest's. */
export function userIdOf(playerId: string): string | null {
  if (!playerId.startsWith(ACCOUNT_PLAYER_PREFIX)) return null;
  const userId = playerId.slice(ACCOUNT_PLAYER_PREFIX.length);
  return isPlayerId(userId) ? userId : null;
}

/**
 * A session for an account. `version` is the account's session version when
 * the session is made: raising the account's ends every session made before.
 */
export function createAccountSession(userId: string, now: number, version: number): string {
  return sign(`${PREFIX}${userId}.${now + ACCOUNT_TTL_MS}.${version}`);
}

/** Who a signed session names, and the session version it was made at. */
export type AccountSession = { userId: string; version: number };

const VERSION = /^\d+$/;

/**
 * What a session says, or null if it is forged, expired or not an account
 * session. A session made before versions were written into it is one of
 * version 0, which is where every account starts. This reads the signature
 * alone: whether the account has since ended the session is `accountIn`'s to ask.
 */
export function accountSessionOf(token: string | undefined, now: number): AccountSession | null {
  const value = verify(token);
  if (!value?.startsWith(PREFIX)) return null;
  const [userId, expires, made = "0"] = value.slice(PREFIX.length).split(".");
  const expiresAt = Number(expires);
  const version = Number(made);
  const sound =
    isPlayerId(userId) && Number.isFinite(expiresAt) && now < expiresAt && VERSION.test(made) && Number.isSafeInteger(version);
  return sound ? { userId, version } : null;
}
