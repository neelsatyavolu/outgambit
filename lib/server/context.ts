import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { getAdapter } from "../ai/registry";
import { getDb } from "../db/client";
import type { Deps } from "../game/deps";
import { clientIp, fail, hashIp, isPlayerId, sameOrigin } from "../http";
import { findOffered } from "../owner/catalog";
import { OWNER_COOKIE, isValidSession } from "../owner/session";

export const PLAYER_COOKIE = "gambit_player";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

export const secureCookies = (): boolean => process.env.NODE_ENV === "production";

/** The game service wired to the real database, clock and providers. */
export async function buildDeps(): Promise<Deps> {
  const db = await getDb();
  return {
    db,
    now: Date.now,
    adapterFor: (game) => getAdapter(db, game.provider, Date.now()),
    schedule: (job) =>
      after(async () => {
        try {
          await job();
        } catch (error) {
          console.error("[gambit] background turn failed", error);
        }
      }),
    findModel: (provider, id) => findOffered(db, provider, id),
    random: Math.random,
  };
}

/** The visitor's anonymous id, from their cookie. `create` issues one if they have none. */
export async function playerId(options: { create: boolean }): Promise<string | undefined> {
  const jar = await cookies();
  const existing = jar.get(PLAYER_COOKIE)?.value;
  if (isPlayerId(existing)) return existing;
  if (!options.create) return undefined;
  const id = randomUUID();
  jar.set(PLAYER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: YEAR_SECONDS,
  });
  return id;
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
