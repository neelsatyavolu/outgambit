import { BUDGET, centsPerMillionTokens } from "../config";
import type { Queryable } from "../db/client";
import { getSettings, setSetting } from "../db/settings";
import { averagePlies, usageSince, type ModelRef, type UsageRow } from "../db/usage";
import { dayKey, nextResetAt } from "../game/limits";
import { headroom, paceLine, type Meter } from "./meter";
import { budgetPool, type Closed, type Pool } from "./pools";
import type { Reading } from "./readings";

/** The providers' own figures, each read at most every few minutes. */
export type UsageSource = {
  /** A subscription's meter. */
  meter: (provider: "codex" | "grok", now: number) => Promise<Reading<Meter>>;
  /** The free-model requests OpenRouter allows the owner's account in a day. */
  openRouterCap: (now: number) => Promise<number>;
};

/** What a model's budget still has room for today, and the figures behind that. */
export type Supply = {
  pool: Pool;
  /** Games that can still start today, going by the budget alone. An estimate. */
  left: number;
  closed: Closed | null;
  /** What has been used and what may be, in the pool's own unit: percent, requests or cents. */
  used: number;
  limit: number;
  resetsAt: number | null;
  /** When a provider's figure was last read, and what went wrong if the last try failed. */
  readAt: number | null;
  error: string | null;
};

/** What Gambit has recorded for itself: its calls, how long games run, and budgets told to wait. */
export type Ledger = {
  day: string;
  /** Each model's calls and tokens, a row for each of the last few days. */
  usage: UsageRow[];
  /** The average length of each model's recent finished games, in plies. */
  plies: Map<string, number>;
  /** Budgets closed for a while after "too many requests", by pool, with when they reopen. */
  paused: Map<string, number>;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PAUSE = "pause:";

const refKey = (model: ModelRef): string => `${model.provider}/${model.model}`;

export async function loadLedger(q: Queryable, now: number): Promise<Ledger> {
  const since = now - WEEK_MS;
  const [usage, plies, paused] = await Promise.all([usageSince(q, dayKey(since)), averagePlies(q, since), getSettings(q, PAUSE)]);
  return {
    day: dayKey(now),
    usage,
    plies: new Map(plies.map((row) => [refKey(row), row.plies])),
    paused: new Map([...paused].map(([pool, until]) => [pool, Number(until)])),
  };
}

/** Closes a free budget for a while: its provider has said "too many requests". */
export function pausePool(q: Queryable, pool: Pool, now: number): Promise<void> {
  return setSetting(q, PAUSE + pool.id, String(now + BUDGET.rateLimitPauseMs));
}

/** The calls a game against a model takes: one for each of its moves in an average recent game. */
export function callsPerGame(ledger: Ledger, model: ModelRef): number {
  const plies = ledger.plies.get(refKey(model));
  return plies === undefined ? BUDGET.callsPerGame : Math.max(BUDGET.minCallsPerGame, Math.ceil(plies / 2));
}

/** The input tokens one call to a model has taken on average lately. */
function tokensPerCall(ledger: Ledger, model: ModelRef): number {
  const rows = ledger.usage.filter((row) => refKey(row) === refKey(model));
  const calls = rows.reduce((sum, row) => sum + row.calls, 0);
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  return calls > 0 && tokens > 0 ? tokens / calls : BUDGET.tokensPerCall;
}

/** Today's rows for every model that draws on `pool`. */
const todayIn = (ledger: Ledger, pool: Pool): UsageRow[] =>
  ledger.usage.filter((row) => row.day === ledger.day && budgetPool(row.provider, row.model)?.id === pool.id);

const gamesIn = (room: number, perGame: number): number => Math.floor(Math.max(0, room) / perGame);

function meterSupply(pool: Pool, reading: Reading<Meter>, now: number): Supply {
  const figures = { pool, readAt: reading.readAt, error: reading.error };
  const unread = { ...figures, left: 0, closed: "usage_unavailable", used: 0, limit: 0, resetsAt: null } as const;
  if (!reading.value) return unread;
  const { weekly } = reading.value;
  // A reading from before the reset describes last week: wait for one of the new week.
  if (now >= weekly.resetsAt) return { ...unread, error: reading.error ?? "week has reset" };
  const { points, closed } = headroom(reading.value, now);
  // A week nobody has used yet has no headroom to measure, and may not even
  // start counting until someone does. One game cannot take it past its share.
  const untouched = weekly.usedPercent === 0 && closed !== "short_window";
  const left = untouched ? Math.max(1, gamesIn(points, BUDGET.percentPerGame)) : closed ? 0 : gamesIn(points, BUDGET.percentPerGame);
  return {
    ...figures,
    left,
    closed: left >= 1 ? null : (closed ?? "pace"),
    used: weekly.usedPercent,
    limit: paceLine(weekly, now),
    resetsAt: weekly.resetsAt,
  };
}

function requestSupply(pool: Pool, model: ModelRef, limit: number, ledger: Ledger, now: number): Supply {
  const used = todayIn(ledger, pool).reduce((sum, row) => sum + row.calls, 0);
  const paused = (ledger.paused.get(pool.id) ?? 0) > now;
  const left = paused ? 0 : gamesIn(limit - used, callsPerGame(ledger, model));
  const closed = paused ? "rate_limited" : left < 1 ? "free_limit" : null;
  return { pool, left, closed, used, limit, resetsAt: nextResetAt(now), readAt: null, error: null };
}

function centSupply(pool: Pool, model: ModelRef, ledger: Ledger, now: number): Supply {
  const centsPerToken = centsPerMillionTokens(model.provider, model.model) / 1_000_000;
  const used = todayIn(ledger, pool).reduce((sum, row) => sum + row.tokens, 0) * centsPerToken;
  const perGame = callsPerGame(ledger, model) * tokensPerCall(ledger, model) * centsPerToken;
  const left = gamesIn(BUDGET.centsPerDay - used, perGame);
  const closed = left < 1 ? "daily_budget" : null;
  return { pool, left, closed, used, limit: BUDGET.centsPerDay, resetsAt: nextResetAt(now), readAt: null, error: null };
}

/**
 * Each model's budget, in the order given. Null for a model that has none.
 * A provider's figure is read once however many of its models are asked about.
 */
export async function supplies(
  q: Queryable,
  usage: UsageSource,
  models: readonly ModelRef[],
  now: number,
): Promise<Array<Supply | null>> {
  const ledger = await loadLedger(q, now);
  const meters = new Map<string, Promise<Reading<Meter>>>();
  const meter = (provider: "codex" | "grok") => {
    if (!meters.has(provider)) meters.set(provider, usage.meter(provider, now));
    return meters.get(provider)!;
  };
  let openRouter: Promise<number> | undefined;
  return Promise.all(
    models.map(async (model) => {
      const pool = budgetPool(model.provider, model.model);
      if (!pool) return null;
      if (model.provider === "codex" || model.provider === "grok") return meterSupply(pool, await meter(model.provider), now);
      if (pool.kind === "cents") return centSupply(pool, model, ledger, now);
      const limit = model.provider === "openrouter" ? await (openRouter ??= usage.openRouterCap(now)) : BUDGET.geminiRequestsPerDay;
      return requestSupply(pool, model, limit, ledger, now);
    }),
  );
}
