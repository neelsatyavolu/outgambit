import type { GameTally } from "../account/stats";
import type { Game, Move, Reason, Result, Status } from "../game/types";
import type { Db, Queryable, Row } from "./client";
import { fromTs, fromTsOrNull, toTs, toTsOrNull } from "./time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowToGame(row: Row): Game {
  return {
    id: row.id as string,
    playerId: row.player_id as string,
    ipHash: row.ip_hash as string,
    day: row.day as string,
    provider: row.provider as Game["provider"],
    model: row.model as string,
    modelLabel: row.model_label as string,
    effort: row.effort as Game["effort"],
    timeControl: row.time_control as string,
    initialMs: row.initial_ms as number,
    incrementMs: row.increment_ms as number,
    playerColor: row.player_color as Game["playerColor"],
    fen: row.fen as string,
    ply: row.ply as number,
    whiteMs: row.white_ms as number,
    blackMs: row.black_ms as number,
    turnStartedAt: fromTs(row.turn_started_at),
    aiLeaseUntil: fromTsOrNull(row.ai_lease_until),
    status: row.status as Status,
    result: row.result as Result | null,
    reason: row.reason as Reason | null,
    createdAt: fromTs(row.created_at),
  };
}

export async function insertGame(q: Queryable, g: Game): Promise<void> {
  await q.query(
    `INSERT INTO games (id, player_id, ip_hash, day, provider, model, model_label, effort, time_control,
       initial_ms, increment_ms, player_color, fen, ply, white_ms, black_ms, turn_started_at, ai_lease_until,
       status, result, reason, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      g.id, g.playerId, g.ipHash, g.day, g.provider, g.model, g.modelLabel, g.effort, g.timeControl,
      g.initialMs, g.incrementMs, g.playerColor, g.fen, g.ply, g.whiteMs, g.blackMs, toTs(g.turnStartedAt),
      toTsOrNull(g.aiLeaseUntil), g.status, g.result, g.reason, toTs(g.createdAt),
    ],
  );
}

export async function getGame(q: Queryable, id: string): Promise<Game | null> {
  if (!UUID.test(id)) return null;
  const rows = await q.query("SELECT * FROM games WHERE id = $1", [id]);
  return rows[0] ? rowToGame(rows[0]) : null;
}

export async function listMoves(q: Queryable, gameId: string): Promise<Move[]> {
  const rows = await q.query("SELECT ply, san, uci, fen_after, spent_ms FROM moves WHERE game_id = $1 ORDER BY ply", [
    gameId,
  ]);
  return rows.map((r) => ({
    ply: r.ply as number,
    san: r.san as string,
    uci: r.uci as string,
    fenAfter: r.fen_after as string,
    spentMs: r.spent_ms as number,
  }));
}

export type DayCounts = { global: number; player: number; ip: number };

/** Games created on `day` that still count toward the limits. */
export async function countForDay(q: Queryable, day: string, playerId: string, ipHash: string): Promise<DayCounts> {
  const [row] = await q.query<DayCounts>(
    `SELECT count(*)::int AS global,
            (count(*) FILTER (WHERE player_id = $2))::int AS player,
            (count(*) FILTER (WHERE ip_hash = $3))::int AS ip
       FROM games WHERE day = $1 AND status <> 'aborted'`,
    [day, playerId, ipHash],
  );
  return { global: row.global, player: row.player, ip: row.ip };
}

export async function activeGameFor(q: Queryable, playerId: string): Promise<Game | null> {
  const rows = await q.query(
    "SELECT * FROM games WHERE player_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [playerId],
  );
  return rows[0] ? rowToGame(rows[0]) : null;
}

/** Live games first, then the most recent. */
export async function listGames(q: Queryable, limit: number): Promise<Game[]> {
  const rows = await q.query(
    "SELECT * FROM games ORDER BY (status = 'active') DESC, created_at DESC LIMIT $1",
    [limit],
  );
  return rows.map(rowToGame);
}

/** One player's games: live first, then the most recent. */
export async function listGamesFor(q: Queryable, playerId: string, limit: number): Promise<Game[]> {
  const rows = await q.query(
    "SELECT * FROM games WHERE player_id = $1 ORDER BY (status = 'active') DESC, created_at DESC LIMIT $2",
    [playerId, limit],
  );
  return rows.map(rowToGame);
}

/** Hands every game played as `from` to `to`. Returns how many moved. */
export async function claimGames(q: Queryable, from: string, to: string): Promise<number> {
  const rows = await q.query("UPDATE games SET player_id = $2 WHERE player_id = $1 RETURNING id", [from, to]);
  return rows.length;
}

/** A player's finished games, counted per model, time control and colour. */
export async function tallyFor(q: Queryable, playerId: string): Promise<GameTally[]> {
  const rows = await q.query(
    `SELECT model_label, time_control, player_color,
            count(*)::int AS played,
            (count(*) FILTER (WHERE result = player_color))::int AS won,
            (count(*) FILTER (WHERE result = 'draw'))::int AS drawn
       FROM games WHERE player_id = $1 AND status = 'finished'
      GROUP BY model_label, time_control, player_color`,
    [playerId],
  );
  return rows.map((r) => ({
    modelLabel: r.model_label as string,
    timeControl: r.time_control as string,
    playerColor: r.player_color as Game["playerColor"],
    played: r.played as number,
    won: r.won as number,
    drawn: r.drawn as number,
  }));
}

export type Ending = { status: Exclude<Status, "active">; result: Result | null; reason: Reason };

export type MoveCommit = {
  gameId: string;
  /** The ply this move is for. The commit is refused if the game has moved on. */
  expectedPly: number;
  move: Omit<Move, "ply">;
  whiteMs: number;
  blackMs: number;
  now: number;
  finish?: Ending;
};

/** Saves a move and advances the game in one transaction. False if the ply was stale. */
export function commitMove(db: Db, c: MoveCommit): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.query(
      `UPDATE games SET fen = $3, ply = ply + 1, white_ms = $4, black_ms = $5, turn_started_at = $6,
              ai_lease_until = NULL, ai_invalid = 0, ai_failures = 0, status = $7, result = $8, reason = $9
        WHERE id = $1 AND ply = $2 AND status = 'active' RETURNING id`,
      [
        c.gameId, c.expectedPly, c.move.fenAfter, c.whiteMs, c.blackMs, toTs(c.now),
        c.finish?.status ?? "active", c.finish?.result ?? null, c.finish?.reason ?? null,
      ],
    );
    if (updated.length === 0) return false;
    await tx.query(
      "INSERT INTO moves (game_id, ply, san, uci, fen_after, spent_ms, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [c.gameId, c.expectedPly, c.move.san, c.move.uci, c.move.fenAfter, c.move.spentMs, toTs(c.now)],
    );
    return true;
  });
}

export type FinishGuard = {
  /** Refuse if the game is no longer at this ply. Everything but a resignation passes it. */
  expectedPly?: number;
  whiteMs?: number;
  blackMs?: number;
};

/** Ends an active game without a move. False if it had already ended or moved on. */
export async function finishGame(q: Queryable, id: string, ending: Ending, guard: FinishGuard = {}): Promise<boolean> {
  const rows = await q.query(
    `UPDATE games SET status = $2, result = $3, reason = $4, ai_lease_until = NULL,
            white_ms = COALESCE($5, white_ms), black_ms = COALESCE($6, black_ms)
      WHERE id = $1 AND status = 'active' AND ($7::int IS NULL OR ply = $7) RETURNING id`,
    [
      id, ending.status, ending.result, ending.reason, guard.whiteMs ?? null, guard.blackMs ?? null,
      guard.expectedPly ?? null,
    ],
  );
  return rows.length > 0;
}

/**
 * Ends every active game whose side to move has run out of time. Polling
 * only reaches games someone is looking at; this reaches the abandoned ones.
 */
export async function expireOverdue(q: Queryable, now: number): Promise<number> {
  const rows = await q.query(
    `UPDATE games SET status = 'finished', reason = 'timeout', ai_lease_until = NULL,
            result = CASE WHEN ply % 2 = 0 THEN 'black' ELSE 'white' END,
            white_ms = CASE WHEN ply % 2 = 0 THEN 0 ELSE white_ms END,
            black_ms = CASE WHEN ply % 2 = 1 THEN 0 ELSE black_ms END
      WHERE status = 'active'
        AND turn_started_at + (CASE WHEN ply % 2 = 0 THEN white_ms ELSE black_ms END) * interval '1 millisecond'
            <= $1::timestamptz
      RETURNING id`,
    [toTs(now)],
  );
  return rows.length;
}

/** Takes the right to run the AI's turn at `ply`. Only one caller wins. */
export async function claimLease(q: Queryable, id: string, ply: number, now: number, until: number): Promise<boolean> {
  const rows = await q.query(
    `UPDATE games SET ai_lease_until = $4
      WHERE id = $1 AND ply = $2 AND status = 'active'
        AND (ai_lease_until IS NULL OR ai_lease_until <= $3) RETURNING id`,
    [id, ply, toTs(now), toTs(until)],
  );
  return rows.length > 0;
}

const HELD = "id = $1 AND ply = $2 AND status = 'active' AND ai_lease_until = $3::timestamptz";

/** Moves a lease's end. False if the caller no longer holds it. */
export async function renewLease(q: Queryable, id: string, ply: number, held: number, until: number): Promise<boolean> {
  const rows = await q.query(`UPDATE games SET ai_lease_until = $4 WHERE ${HELD} RETURNING id`, [
    id, ply, toTs(held), toTs(until),
  ]);
  return rows.length > 0;
}

export type AttemptCounts = { invalid: number; failures: number };

/**
 * Counts one failed attempt at the AI's current turn. The counts live in the
 * database so they survive a hand-over between runners. Null if the caller
 * no longer holds the lease.
 */
export async function recordAttempt(
  q: Queryable,
  id: string,
  ply: number,
  held: number,
  kind: "invalid" | "provider_error",
): Promise<AttemptCounts | null> {
  const column = kind === "invalid" ? "ai_invalid" : "ai_failures";
  const rows = await q.query<{ ai_invalid: number; ai_failures: number }>(
    `UPDATE games SET ${column} = ${column} + 1 WHERE ${HELD} RETURNING ai_invalid, ai_failures`,
    [id, ply, toTs(held)],
  );
  return rows[0] ? { invalid: rows[0].ai_invalid, failures: rows[0].ai_failures } : null;
}
