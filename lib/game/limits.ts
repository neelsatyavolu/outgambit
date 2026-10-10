import { DAY_TIME_ZONE, LIMITS } from "../config";
import type { Queryable } from "../db/client";
import { countForDay } from "../db/games";

// en-CA formats dates as YYYY-MM-DD.
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Pacific calendar date a moment falls on. */
export const dayKey = (now: number): string => dayFormat.format(new Date(now));

const LONGEST_DAY_MS = 26 * 60 * 60 * 1000;

/** The next Pacific midnight. Found by search, so 23- and 25-hour days need no special case. */
export function nextResetAt(now: number): number {
  const today = dayKey(now);
  let stillToday = now;
  let tomorrow = now + LONGEST_DAY_MS;
  while (tomorrow - stillToday > 1) {
    const middle = Math.floor((stillToday + tomorrow) / 2);
    if (dayKey(middle) === today) stillToday = middle;
    else tomorrow = middle;
  }
  return tomorrow;
}

export type Blocked = "player" | "network" | "global" | null;

export type Capacity = {
  player: { used: number; limit: number };
  global: { used: number; limit: number };
  resetAt: number;
  /** Which limit stops this visitor from starting a game, if any. */
  blocked: Blocked;
};

export async function capacity(q: Queryable, playerId: string, ipHash: string, now: number): Promise<Capacity> {
  const counts = await countForDay(q, dayKey(now), playerId, ipHash);
  const blocked: Blocked =
    counts.global >= LIMITS.globalPerDay
      ? "global"
      : counts.player >= LIMITS.playerPerDay
        ? "player"
        : counts.ip >= LIMITS.ipPerDay
          ? "network"
          : null;
  // A visitor stopped by the network backstop has no games left either.
  const playerUsed = blocked === "network" ? LIMITS.playerPerDay : Math.min(counts.player, LIMITS.playerPerDay);
  return {
    player: { used: playerUsed, limit: LIMITS.playerPerDay },
    global: { used: Math.min(counts.global, LIMITS.globalPerDay), limit: LIMITS.globalPerDay },
    resetAt: nextResetAt(now),
    blocked,
  };
}
