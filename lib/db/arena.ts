import type { Game } from "../game/types";
import type { Queryable } from "./client";
import { rowToGame } from "./games";

// An arena game is one with a model in the player's seat.
const ARENA = "rival_model IS NOT NULL";

export async function activeArenaGame(q: Queryable): Promise<Game | null> {
  const rows = await q.query(`SELECT * FROM games WHERE ${ARENA} AND status = 'active' ORDER BY created_at LIMIT 1`);
  return rows[0] ? rowToGame(rows[0]) : null;
}

/** Arena games: the live one first, then the most recent. */
export async function listArenaGames(q: Queryable, limit: number): Promise<Game[]> {
  const rows = await q.query(
    `SELECT * FROM games WHERE ${ARENA} ORDER BY (status = 'active') DESC, created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(rowToGame);
}

/**
 * Arena games started on `day` that count toward the day's budget. A game
 * called off before its first move cost nothing and does not count; one
 * called off later has spent its calls and does.
 */
export async function countArenaForDay(q: Queryable, day: string): Promise<number> {
  const [row] = await q.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM games WHERE ${ARENA} AND day = $1 AND (status <> 'aborted' OR ply > 0)`,
    [day],
  );
  return row.count;
}

/** Arena games started on `day` that were called off because a model could not answer. */
export async function abortedArenaGames(q: Queryable, day: string): Promise<Game[]> {
  const rows = await q.query(
    `SELECT * FROM games WHERE ${ARENA} AND day = $1 AND status = 'aborted' AND reason = 'provider_error'`,
    [day],
  );
  return rows.map(rowToGame);
}

type Side = Pick<Game, "provider" | "model" | "effort">;

/** Two models that have finished arena games against each other at a time control, and how many. */
export type ArenaMeeting = { sides: [Side, Side]; timeControl: string; games: number };

export async function arenaMeetings(q: Queryable): Promise<ArenaMeeting[]> {
  const rows = await q.query(
    `SELECT provider, model, effort, rival_provider, rival_model, rival_effort, time_control, count(*)::int AS games
       FROM games WHERE ${ARENA} AND status = 'finished'
      GROUP BY provider, model, effort, rival_provider, rival_model, rival_effort, time_control`,
  );
  return rows.map((r) => ({
    sides: [
      { provider: r.provider as Side["provider"], model: r.model as string, effort: r.effort as Side["effort"] },
      {
        provider: r.rival_provider as Side["provider"],
        model: r.rival_model as string,
        effort: r.rival_effort as Side["effort"],
      },
    ],
    timeControl: r.time_control as string,
    games: r.games as number,
  }));
}
