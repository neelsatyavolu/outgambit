import { BUDGET } from "../config";
import type { Queryable } from "../db/client";
import { gameCounts, playersSince, type GameCounts } from "../db/usage";
import { dayKey, nextResetAt } from "../game/limits";
import type { Provider } from "../game/types";
import { budgetPool, type Closed, type Pool, type PoolKind } from "./pools";
import { arenaRoom, expectedPlayers, playerShare } from "./share";
import { supplies, type Supply, type UsageSource } from "./supply";

/** Why this visitor cannot start a game against a model: its budget is closed, or their own share of it is used. */
export type Blocked = Closed | "player" | "network";

/** What one visitor may still play against a model today. */
export type Allowance = {
  /** Games they have started on this budget today, and how many they may. */
  used: number;
  limit: number;
  /** Games anyone can still start on it today. */
  left: number;
  blocked: Blocked | null;
};

/** Who is asking for games today: what has been started, how many players to split between, and how much of the day is left. */
export type Demand = { counts: GameCounts[]; expected: number; dayFractionLeft: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_OVER_DAYS = 7;

/** What a budget with nothing left is called, by what it counts. */
const SPENT: Record<PoolKind, Closed> = { meter: "pace", requests: "free_limit", cents: "daily_budget" };

export async function loadDemand(q: Queryable, who: { playerId: string; ipHash: string }, now: number): Promise<Demand> {
  const day = dayKey(now);
  const since = now - AVERAGE_OVER_DAYS * DAY_MS;
  const [counts, players] = await Promise.all([
    gameCounts(q, day, who.playerId, who.ipHash, since),
    playersSince(q, day, since),
  ]);
  const dayFractionLeft = Math.min(1, (nextResetAt(now) - now) / DAY_MS);
  const expected = expectedPlayers({
    activeToday: players.today,
    dailyAverage: players.earlier / AVERAGE_OVER_DAYS,
    dayFractionLeft,
  });
  return { counts, expected, dayFractionLeft };
}

/** The day's games on one budget, across every model that draws on it. */
function poolCounts(pool: Pool, counts: readonly GameCounts[]): Omit<GameCounts, "provider" | "model"> {
  const rows = counts.filter((row) => budgetPool(row.provider, row.model)?.id === pool.id);
  const sum = (pick: (row: GameCounts) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    total: sum((r) => r.total), player: sum((r) => r.player), ip: sum((r) => r.ip),
    active: sum((r) => r.active), earlier: sum((r) => r.earlier),
  };
}

/** A budget's games for the day, and one player's share of them. */
function split(supply: Supply, demand: Demand) {
  const counts = poolCounts(supply.pool, demand.counts);
  // A game being played has not spent its calls yet, so each one still holds a place.
  const left = Math.max(0, supply.left - counts.active);
  return { counts, left, share: playerShare(counts.total + left, demand.expected) };
}

/** What a visitor may play on a budget. Null when the model has no budget, and so no limit. */
export function allowance(supply: Supply | null, demand: Demand): Allowance | null {
  if (!supply) return null;
  const { counts, left, share } = split(supply, demand);
  const blocked: Blocked | null =
    supply.closed ??
    (left < 1
      ? SPENT[supply.pool.kind]
      : counts.player >= share
        ? "player"
        : counts.ip >= share * BUDGET.networkShares
          ? "network"
          : null);
  return { used: Math.min(counts.player, share), limit: share, left, blocked };
}

/** What a visitor may play against each of `models`, by "provider/id". */
export async function allowances(
  q: Queryable,
  usage: UsageSource,
  models: ReadonlyArray<{ provider: Provider; id: string }>,
  who: { playerId: string; ipHash: string },
  now: number,
): Promise<Record<string, Allowance | null>> {
  const [budgets, demand] = await Promise.all([
    supplies(q, usage, models.map((m) => ({ provider: m.provider, model: m.id })), now),
    loadDemand(q, who, now),
  ]);
  return Object.fromEntries(models.map((m, i) => [`${m.provider}/${m.id}`, allowance(budgets[i], demand)]));
}

/** The games the arena may start on a budget: only what players do not usually get round to. */
export function arenaGames(supply: Supply | null, demand: Demand): number {
  if (!supply) return Number.POSITIVE_INFINITY;
  if (supply.closed) return 0;
  const { counts, left } = split(supply, demand);
  return arenaRoom(left, counts.earlier / AVERAGE_OVER_DAYS, demand.dayFractionLeft);
}
