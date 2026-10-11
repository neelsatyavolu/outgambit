import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { accountIn } from "../account/accounts";
import { ACCOUNT_COOKIE, ACCOUNT_TTL_MS, accountPlayerId, createAccountSession } from "../account/session";
import { getAdapter } from "../ai/registry";
import { usageSource } from "../budget/sources";
import { getDb } from "../db/client";
import { sessionVersionOf } from "../db/users";
import type { Deps } from "../game/deps";
import { clientIp, fail, hashIp, isPlayerId, sameOrigin } from "../http";
import { findOffered } from "../owner/catalog";
import type { KeyCache } from "../owner/credentials";
import { OWNER_COOKIE, isValidSession } from "../owner/session";

export const PLAYER_COOKIE = "gambit_player";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

export const secureCookies = (): boolean => process.env.NODE_ENV === "production";

/** API keys this server instance has read in the last minute. */
const keys: KeyCache = new Map();

/** The game service wired to the real database, clock and providers. */
export async function buildDeps(): Promise<Deps> {
  const db = await getDb();
  return {
    db,
    now: Date.now,
    adapterFor: (seat, options) => getAdapter(db, seat.provider, Date.now(), fetch, { ...options, keys }),
    schedule: (job) =>
      after(async () => {
        try {
          await job();
        } catch (error) {
          console.error("[gambit] background turn failed", error);
        }
      }),
    findModel: (provider, id) => findOffered(db, provider, id),
    usage: usageSource(db),
    random: Math.random,
  };
}

/** The account a session cookie is live for. A browser with no cookie costs no database read. */
async function accountBehind(token: string | undefined): Promise<string | null> {
  return token ? accountIn(await getDb(), token, Date.now()) : null;
}

/** The signed-in account's user id, or null for a guest. */
export async function accountId(): Promise<string | null> {
  const jar = await cookies();
  return accountBehind(jar.get(ACCOUNT_COOKIE)?.value);
}

/** The anonymous id this browser has played under, whether or not it is signed in. */
export async function guestId(): Promise<string | undefined> {
  const value = (await cookies()).get(PLAYER_COOKIE)?.value;
  return isPlayerId(value) ? value : undefined;
}

/** Signs this browser in to an account, at the session version the account is at now. */
export async function startAccountSession(userId: string): Promise<void> {
  const version = await sessionVersionOf(await getDb(), userId);
  if (version === null) throw new Error("Cannot sign in to an account that does not exist");
  (await cookies()).set(ACCOUNT_COOKIE, createAccountSession(userId, Date.now(), version), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: ACCOUNT_TTL_MS / 1000,
  });
}

export type Visitor = { userId: string | null; playerId: string | undefined };

/**
 * Who is asking: the account they are signed in to, if any, and the id they
 * play under, which is that account or else the anonymous id in their cookie.
 * `create` issues an anonymous id if they have neither. The session is read
 * once here, where asking for the account and the player apart reads it twice.
 */
export async function visitor(options: { create: boolean }): Promise<Visitor> {
  const jar = await cookies();
  const userId = await accountBehind(jar.get(ACCOUNT_COOKIE)?.value);
  if (userId) return { userId, playerId: accountPlayerId(userId) };
  const existing = jar.get(PLAYER_COOKIE)?.value;
  if (isPlayerId(existing)) return { userId, playerId: existing };
  if (!options.create) return { userId, playerId: undefined };
  const id = randomUUID();
  jar.set(PLAYER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: YEAR_SECONDS,
  });
  return { userId, playerId: id };
}

/** The id this visitor plays under. See `visitor`. */
export async function playerId(options: { create: boolean }): Promise<string | undefined> {
  return (await visitor(options)).playerId;
}

export const ipHashOf = (request: Request): string => hashIp(clientIp(request));

export async function isOwner(): Promise<boolean> {
  const jar = await cookies();
  return isValidSession(jar.get(OWNER_COOKIE)?.value, Date.now());
}

/** Refuses a request that is not from the signed-in owner. Returns null when it may proceed. */
export async function refuseUnlessOwner(request: Request): Promise<Response | null> {
  if (request.method !== "GET" && !sameOrigin(request)) return fail("Request refused.", 403);
  return (await isOwner()) ? null : fail("Sign in as the owner first.", 401);
}
