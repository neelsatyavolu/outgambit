import type { Provider } from "../game/types";
import type { Queryable } from "./client";
import { toTs } from "./time";

export type ModelRef = { provider: Provider; model: string };

/** Notes one call to a model, and the input tokens it reported using, if it said. */
export async function recordUsage(q: Queryable, day: string, model: ModelRef, inputTokens: number): Promise<void> {
  await q.query(
    `INSERT INTO usage (day, provider, model, calls, input_tokens) VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (day, provider, model) DO UPDATE SET
       calls = usage.calls + 1, input_tokens = usage.input_tokens + EXCLUDED.input_tokens`,
    [day, model.provider, model.model, inputTokens],
  );
}

export type UsageRow = ModelRef & { day: string; calls: number; tokens: number };

/** Every model's calls and tokens, a row for each day from `fromDay` on. */
export function usageSince(q: Queryable, fromDay: string): Promise<UsageRow[]> {
  return q.query<UsageRow>(
    "SELECT day, provider, model, calls, input_tokens AS tokens FROM usage WHERE day >= $1",
    [fromDay],
  );
}

export type GameCounts = ModelRef & {
  /** Games people started against the model on the day. A game called off does not count. */
  total: number;
  /** Those of them this player started. */
  player: number;
  /** Those of them started from this network. */
  ip: number;
  /** Games against the model still being played, whoever or whatever started them. */
  active: number;
  /** Games people started against it from `since` up to the day. */
  earlier: number;
};

export function gameCounts(q: Queryable, day: string, playerId: string, ipHash: string, since: number): Promise<GameCounts[]> {
  const played = "rival_model IS NULL AND status <> 'aborted'";
  return q.query<GameCounts>(
    `SELECT provider, model,
            (count(*) FILTER (WHERE day = $1 AND ${played}))::int AS total,
            (count(*) FILTER (WHERE day = $1 AND ${played} AND player_id = $2))::int AS player,
            (count(*) FILTER (WHERE day = $1 AND ${played} AND ip_hash = $3))::int AS ip,
            (count(*) FILTER (WHERE status = 'active'))::int AS active,
            (count(*) FILTER (WHERE day <> $1 AND created_at >= $4 AND ${played}))::int AS earlier
       FROM games WHERE day = $1 OR status = 'active' OR created_at >= $4 GROUP BY provider, model`,
    [day, playerId, ipHash, toTs(since)],
  );
}

/** How many different people played on `day`, and how many player-days there were from `since` up to it. */
export async function playersSince(q: Queryable, day: string, since: number): Promise<{ today: number; earlier: number }> {
  const [row] = await q.query<{ today: number; earlier: number }>(
    `SELECT (count(DISTINCT player_id) FILTER (WHERE day = $1))::int AS today,
            (count(DISTINCT (day, player_id)) FILTER (WHERE day <> $1))::int AS earlier
       FROM games WHERE rival_model IS NULL AND status <> 'aborted' AND (day = $1 OR created_at >= $2)`,
    [day, toTs(since)],
  );
  return row;
}

/** The average length, in plies, of each model's finished games since `since`. */
export function averagePlies(q: Queryable, since: number): Promise<Array<ModelRef & { plies: number }>> {
  return q.query<ModelRef & { plies: number }>(
    `SELECT provider, model, avg(ply)::float8 AS plies FROM games
      WHERE status = 'finished' AND created_at >= $1 GROUP BY provider, model`,
    [toTs(since)],
  );
}
