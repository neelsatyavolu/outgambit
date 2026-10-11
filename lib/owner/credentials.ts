import "server-only";
import { refreshTokens, type Tokens } from "@neelsatyavolu/shared-ai-auth";
import type { Db, Queryable } from "../db/client";
import { getConnection, putConnection } from "../db/connections";
import type { Provider } from "../game/types";
import { decrypt, encrypt } from "./crypto";

export type OAuthProvider = "codex" | "grok";
export type Secret = { kind: "oauth"; tokens: Tokens } | { kind: "key"; apiKey: string };
export type Refresh = (provider: OAuthProvider, refreshToken: string, options: { previous: Tokens }) => Promise<Tokens>;

/** Refresh this long before a token expires. */
const REFRESH_MARGIN_MS = 60_000;

/** How long an API key is used before it is read from the database again. */
const KEY_CACHE_MS = 60_000;

/** API keys already read, and when. Sign-in tokens are never kept: they expire and are refreshed under a lock. */
export type KeyCache = Map<Provider, { secret: Secret; readAt: number }>;

export const readSecret = (blob: string): Secret => JSON.parse(decrypt(blob)) as Secret;

export function saveSecret(q: Queryable, provider: Provider, secret: Secret, now: number): Promise<void> {
  return putConnection(q, provider, encrypt(JSON.stringify(secret)), now);
}

const isFresh = (secret: Secret, now: number): boolean =>
  secret.kind === "key" || secret.tokens.expiresAt > now + REFRESH_MARGIN_MS;

/**
 * The stored credentials for a provider, or null if it is not connected.
 * OAuth tokens near expiry are refreshed while holding the row lock, so two
 * games cannot spend the same refresh token. `force` refreshes regardless,
 * for when the provider has rejected tokens that had not expired.
 *
 * With a `cache`, an API key read within the last minute is not read again,
 * which saves a trip to the database on every move against a fast opponent.
 * The price is that a key the owner replaces or removes can stay in use for
 * up to that minute. `force` reads past the cache.
 */
export async function getCredentials(
  db: Db,
  provider: Provider,
  now: number,
  refresh: Refresh = refreshTokens,
  options: { force?: boolean; cache?: KeyCache } = {},
): Promise<Secret | null> {
  const kept = options.force ? undefined : options.cache?.get(provider);
  if (kept && now - kept.readAt < KEY_CACHE_MS) return kept.secret;
  const stored = await getConnection(db, provider);
  if (!stored) {
    options.cache?.delete(provider);
    return null;
  }
  const secret = readSecret(stored.secret);
  if (secret.kind === "key") {
    options.cache?.set(provider, { secret, readAt: now });
    return secret;
  }
  if (isFresh(secret, now) && !options.force) return secret;

  return db.transaction(async (tx) => {
    const locked = await getConnection(tx, provider, true);
    if (!locked) return null;
    const current = readSecret(locked.secret);
    // Someone else may have refreshed while this caller waited for the lock.
    const refreshedMeanwhile = current.kind === "oauth" && current.tokens.accessToken !== secret.tokens.accessToken;
    if (current.kind === "key" || refreshedMeanwhile || (isFresh(current, now) && !options.force)) return current;
    const tokens = await refresh(provider as OAuthProvider, current.tokens.refreshToken, { previous: current.tokens });
    const next: Secret = { kind: "oauth", tokens };
    await saveSecret(tx, provider, next, now);
    return next;
  });
}
