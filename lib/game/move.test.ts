import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { counting, resetDb, testDb } from "@/test/db";
import { NOON } from "@/test/factory";
import { harness, input } from "@/test/game";
import type { Db, Queryable, Row } from "../db/client";
import { getGame, listMoves } from "../db/games";
import { usageSince } from "../db/usage";
import { createGame } from "./create";
import { playerMove, resign } from "./move";
import { getGameView } from "./state";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

async function start(h: ReturnType<typeof harness>, overrides = {}) {
  const created = await createGame(h.deps, input(overrides));
  if (!created.ok) throw new Error(created.error);
  return created.game.id;
}

describe("playerMove", () => {
  it("keeps a move received before the deadline ahead of a timeout poll during validation", async () => {
    const h = harness(db);
    const id = await start(h, { timeControl: "1+0" });
    let read!: () => void;
    const readStarted = new Promise<void>((resolve) => { read = resolve; });
    let release!: () => void;
    const validation = new Promise<void>((resolve) => { release = resolve; });
    let paused = false;
    const delayRead = (query: Db["query"]): Db["query"] => async <T>(sql: string, params?: unknown[]) => {
      const rows = await query<T>(sql, params);
      if (!paused && sql.includes("FROM games WHERE id = $1")) {
        paused = true;
        read();
        await validation;
      }
      return rows;
    };
    h.deps.db = {
      query: delayRead(db.query),
      transaction: (fn) => db.transaction((tx) => fn({ query: delayRead(tx.query) })),
    };
    h.clock.now = NOON + 59_999;
    const move = playerMove(h.deps, id, "player-1", "e2e4", 0);
    await readStarted;
    h.clock.now = NOON + 60_001;
    const poll = getGameView(h.deps, id, { playerId: "player-1", owner: false });
    // A held transaction blocks the poll on PGlite; PostgreSQL instead blocks
    // its timeout UPDATE on the locked row. Neither may overtake the move.
    await new Promise((resolve) => setTimeout(resolve, 40));
    release();
    expect(await move).toEqual({ ok: true });
    await poll;
    expect((await listMoves(db, id))[0]).toMatchObject({ san: "e4", spentMs: 59_999 });
    expect(await getGame(db, id)).toMatchObject({ status: "active", whiteMs: 1 });
  });

  it("charges to move arrival, excluding database reads from the player's clock", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    h.clock.now = NOON + 599_999;
    h.deps.db = {
      ...db,
      transaction: (fn) => db.transaction((tx) => fn({
        query: async <T>(sql: string, params?: unknown[]) => {
          const rows = await tx.query<T>(sql, params);
          h.clock.now += 37;
          return rows;
        },
      })),
    };
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: true });
    expect(await getGame(db, id)).toMatchObject({ whiteMs: 10_001, turnStartedAt: NOON + 600_036 });
    expect((await listMoves(db, id))[0].spentMs).toBe(599_999);
  });

  it("resolves identity on the locked transaction and releases it before AI work", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h);
    let locked = false;
    let active = false;
    h.deps.db = {
      query: async <T>(sql: string, params?: unknown[]) => {
        expect(active).toBe(false);
        return db.query<T>(sql, params);
      },
      transaction: async (fn) => {
        active = true;
        try {
          return await db.transaction((tx) => fn({
            query: async <T>(sql: string, params?: unknown[]) => {
              const rows = await tx.query<T>(sql, params);
              if (sql.includes("FOR UPDATE")) locked = true;
              return rows;
            },
          }));
        } finally {
          active = false;
        }
      },
    };
    h.clock.now += 599_999;
    const resolvePlayer = async (tx: Queryable) => {
      expect(locked).toBe(true);
      expect(await tx.query("SELECT 1 AS authenticated")).toEqual([{ authenticated: 1 }]);
      h.clock.now += 123;
      return "player-1";
    };
    expect(await playerMove(h.deps, id, resolvePlayer, "e2e4", 0)).toEqual({ ok: true });
    expect(await getGame(db, id)).toMatchObject({ whiteMs: 10_001, ply: 2 });
    expect(h.requests).toHaveLength(1);
  });

  it("freezes the running clock at resignation", async () => {
    const h = harness(db);
    const id = await start(h);
    h.clock.now += 1_237;
    await resign(h.deps, id, "player-1");
    expect(await getGame(db, id)).toMatchObject({ whiteMs: 598_763, blackMs: 600_000 });
  });

  it.each(["white", "black"] as const)("records %s's timeout if resignation arrives after its deadline", async (mover) => {
    const h = harness(db);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    if (mover === "black") await playerMove(h.deps, id, "player-1", "e2e4", 0);
    h.clock.now = NOON + 600_000;
    expect(await resign(h.deps, id, "player-1")).toBe(true);
    expect(await getGame(db, id)).toMatchObject({
      reason: "timeout", result: mover === "white" ? "black" : "white",
      ...(mover === "white" ? { whiteMs: 0 } : { blackMs: 0 }),
    });
  });

  it("gives back half the round trip on a bullet clock, up to 150ms", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { timeControl: "1+0" });
    h.clock.now = NOON + 1_000;
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0, h.clock.now, 200)).toEqual({ ok: true });
    expect(await getGame(db, id)).toMatchObject({ whiteMs: 59_100 });
  });

  it("does not give the lag back on a slow clock", async () => {
    const slow = harness(db, ["e5"]);
    const slowId = await start(slow, { timeControl: "10+10" });
    slow.clock.now = NOON + 1_000;
    expect(await playerMove(slow.deps, slowId, "player-1", "e2e4", 0, slow.clock.now, 200)).toEqual({ ok: true });
    expect(await getGame(db, slowId)).toMatchObject({ whiteMs: 609_000 });
  });

  it("still flags when the move arrives later than the refund can cover", async () => {
    const h = harness(db);
    const id = await start(h, { timeControl: "1+0" });
    h.clock.now = NOON + 60_200;
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0, h.clock.now, 1_000)).toEqual({ ok: false, error: "out_of_time" });
  });

  it("flags a human move at the exact millisecond deadline", async () => {
    const h = harness(db);
    const id = await start(h, { timeControl: "1+0" });
    h.clock.now = NOON + 60_000;
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: false, error: "out_of_time" });
    expect(await getGame(db, id)).toMatchObject({ reason: "timeout", whiteMs: 0 });
  });

  it("plays the move, charges the clock, and lets a fast AI answer in the same call", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { timeControl: "2+1" });
    h.clock.now = NOON + 5_000;
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: true });
    const game = await getGame(db, id);
    expect(game).toMatchObject({ ply: 2, whiteMs: 116_000, status: "active" });
    expect((await listMoves(db, id)).map((m) => m.san)).toEqual(["e4", "e5"]);
    expect((await listMoves(db, id))[0].spentMs).toBe(5_000);
  });

  it("schedules a slow AI's answer without waiting", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    expect((await getGame(db, id))?.ply).toBe(1);
    await h.runJobs();
    expect((await getGame(db, id))?.ply).toBe(2);
  });

  it("plays a whole game to checkmate", async () => {
    const h = harness(db, ["e5", "Qh4#"]);
    const id = await start(h);
    await playerMove(h.deps, id, "player-1", "f2f3", 0);
    await playerMove(h.deps, id, "player-1", "g2g4", 2);
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "black", reason: "checkmate", ply: 4 });
  });

  it("does not ask the AI to move after the player ends the game", async () => {
    const h = harness(db, ["f6", "g5"]);
    const id = await start(h);
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    await playerMove(h.deps, id, "player-1", "d2d4", 2);
    await playerMove(h.deps, id, "player-1", "d1h5", 4);
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "white", reason: "checkmate" });
    expect(h.requests).toHaveLength(2);
  });

  it("rejects an illegal move and changes nothing", async () => {
    const h = harness(db);
    const id = await start(h);
    expect(await playerMove(h.deps, id, "player-1", "e2e5", 0)).toEqual({ ok: false, error: "illegal_move" });
    expect((await getGame(db, id))?.ply).toBe(0);
  });

  it("rejects a move when it is the AI's turn", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    expect(await playerMove(h.deps, id, "player-1", "d2d4", 1)).toEqual({ ok: false, error: "not_your_turn" });
  });

  it("rejects the same move sent twice and charges the clock once", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    h.clock.now = NOON + 3_000;
    const results = await Promise.all([
      playerMove(h.deps, id, "player-1", "e2e4", 0),
      playerMove(h.deps, id, "player-1", "e2e4", 0),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listMoves(db, id)).toHaveLength(1);
    expect((await getGame(db, id))?.whiteMs).toBe(600_000 - 3_000 + 10_000);
    expect(h.jobs).toHaveLength(1);
  });

  it("rejects a move made for a position the game has left", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h);
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    expect(await playerMove(h.deps, id, "player-1", "g1f3", 0)).toEqual({ ok: false, error: "stale" });
  });

  it("hides another player's game", async () => {
    const h = harness(db);
    const id = await start(h);
    expect(await playerMove(h.deps, id, "intruder", "e2e4", 0)).toEqual({ ok: false, error: "not_found" });
    expect(await playerMove(h.deps, "not-a-game", "player-1", "e2e4", 0)).toEqual({ ok: false, error: "not_found" });
  });

  it("ends the game when the player moves after their time ran out", async () => {
    const h = harness(db);
    const id = await start(h, { timeControl: "1+0" });
    h.clock.now = NOON + 61_000;
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: false, error: "out_of_time" });
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "black", reason: "timeout", whiteMs: 0, ply: 0 });
  });

  it("rejects a move in a finished game", async () => {
    const h = harness(db);
    const id = await start(h);
    await resign(h.deps, id, "player-1");
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: false, error: "not_active" });
  });

  // Every trip is a few milliseconds the player waits for the reply in a one-minute game.
  it("plays the move and a fast opponent's paid reply in seven trips to the database", async () => {
    const counted = counting(db);
    const h = harness(counted.db, ["e5"]);
    const id = await start(h, { provider: "jev", model: "jev-latest", timeControl: "1+0" });
    const before = counted.trips();
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: true });
    // BEGIN/COMMIT add two trips; the single locked snapshot replaces two reads.
    expect(counted.trips() - before).toBeLessThanOrEqual(7);
    expect((await listMoves(db, id)).map((m) => m.san)).toEqual(["e4", "e5"]);
    expect(await usageSince(db, "2026-10-09")).toMatchObject([{ provider: "jev", calls: 1 }]);
  });

  it("refuses a move when the moves it read are not the whole game", async () => {
    // A corrupt position/history snapshot must never be used to play a move.
    const behind: Db = {
      ...db,
      transaction: (fn) => db.transaction((tx) => fn({
        query: async <T>(sql: string, params?: unknown[]) => {
          const rows = await tx.query<T>(sql, params);
          return sql.includes("jsonb_agg")
            ? rows.map((row) => ({ ...row, moves: ((row as Row).moves as unknown[]).slice(0, -1) })) as T[]
            : rows;
        },
      })),
    };
    const h = harness(behind, ["e5"]);
    const id = await start(h);
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    expect(await playerMove(h.deps, id, "player-1", "d2d4", 2)).toEqual({ ok: false, error: "stale" });
    expect((await getGame(db, id))?.ply).toBe(2);
  });
});

describe("resign", () => {
  it("gives the game to the AI", async () => {
    const h = harness(db);
    const id = await start(h, { color: "white" });
    expect(await resign(h.deps, id, "player-1")).toBe(true);
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "black", reason: "resignation" });
  });

  it("does nothing for someone else's game or a game already over", async () => {
    const h = harness(db);
    const id = await start(h);
    expect(await resign(h.deps, id, "intruder")).toBe(false);
    await resign(h.deps, id, "player-1");
    expect(await resign(h.deps, id, "player-1")).toBe(false);
  });
});
