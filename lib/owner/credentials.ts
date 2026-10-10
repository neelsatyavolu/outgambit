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

export const readSecret = (blob: string): Secret => JSON.parse(decrypt(blob)) as Secret;

export function saveSecret(q: Queryable, provider: Provider, secret: Secret, now: number): Promise<void> {
  return putConnection(q, provider, encrypt(JSON.stringify(secret)), now);
}

const isFresh = (secret: Secret, now: number): boolean =>
  secret.kind === "key" || secret.tokens.expiresAt > now + REFRESH_MARGIN_MS;

/**
 * The stored credentials for a provider, or null if it is not connected.
 * OAuth tokens near expiry are refreshed while holding the row lock, so two
 * games cannot spend the same refresh token.
 */
export async function getCredentials(
  db: Db,
  provider: Provider,
  now: number,
  refresh: Refresh = refreshTokens,
): Promise<Secret | null> {
  const stored = await getConnection(db, provider);
  if (!stored) return null;
  const secret = readSecret(stored.secret);
  if (isFresh(secret, now)) return secret;

  return db.transaction(async (tx) => {
    const locked = await getConnection(tx, provider, true);
    if (!locked) return null;
    const current = readSecret(locked.secret);
    if (current.kind === "key" || isFresh(current, now)) return current;
    const tokens = await refresh(provider as OAuthProvider, current.tokens.refreshToken, { previous: current.tokens });
    const next: Secret = { kind: "oauth", tokens };
    await saveSecret(tx, provider, next, now);
    return next;
  });
}
