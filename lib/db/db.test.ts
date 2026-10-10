import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { makeGame, NOON } from "@/test/factory";
import { createPgliteDb, createPostgresDb, type Db } from "./client";
import { deleteConnection, getConnection, listConnections, putConnection } from "./connections";
import {
  activeGameFor, claimLease, commitMove, countForDay, expireOverdue, finishGame, getGame, insertGame, listGames,
  listMoves, recordAttempt, renewLease,
} from "./games";
import { deleteModel, listModelRows, upsertModel } from "./models";
import { hitRateLimit } from "./rate-limit";
import { migrate } from "./schema";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const E4 = { san: "e4", uci: "e2e4", fenAfter: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", spentMs: 4_000 };

describe("schema", () => {
  it("can be migrated twice", async () => {
    await expect(migrate(db)).resolves.toBeUndefined();
  });
});

describe("createPgliteDb", () => {
  it("creates its data folder, including missing parents", async () => {
    const root = mkdtempSync(join(tmpdir(), "gambit-"));
    try {
      const onDisk = await createPgliteDb(join(root, "nested", "data"));
      expect(await onDisk.query("SELECT 1 AS one")).toEqual([{ one: 1 }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("createPostgresDb", () => {
  it("survives the server dropping its idle connections", async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const victim = await createPostgresDb(`${url}?application_name=gambit_idle_test`);
    await victim.query("SELECT 1");
    await db.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'gambit_idle_test'");
    // An unhandled pool error would surface here as an uncaught exception and fail the run.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await victim.query("SELECT 2 AS two")).toEqual([{ two: 2 }]);
  });
});

describe("games", () => {
  it("round-trips a game", async () => {
    const game = makeGame({ effort: "high" });
    await insertGame(db, game);
    expect(await getGame(db, game.id)).toEqual(game);
  });

  it("returns null for an unknown game", async () => {
    expect(await getGame(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("returns null for an id that is not a UUID", async () => {
    expect(await getGame(db, "nope")).toBeNull();
  });

  it("commits a move and advances the game", async () => {
    const game = makeGame();
    await insertGame(db, game);
    const ok = await commitMove(db, {
      gameId: game.id, expectedPly: 0, move: E4, whiteMs: 606_000, blackMs: 600_000, now: NOON + 4_000,
    });
    expect(ok).toBe(true);
    expect(await getGame(db, game.id)).toMatchObject({
      ply: 1, fen: E4.fenAfter, whiteMs: 606_000, turnStartedAt: NOON + 4_000, status: "active",
    });
    expect(await listMoves(db, game.id)).toEqual([{ ply: 0, ...E4 }]);
  });

  it("rejects a move for a ply that has already been played", async () => {
    const game = makeGame();
    await insertGame(db, game);
    const commit = { gameId: game.id, expectedPly: 0, move: E4, whiteMs: 1, blackMs: 1, now: NOON };
    expect(await commitMove(db, commit)).toBe(true);
    expect(await commitMove(db, commit)).toBe(false);
    expect(await listMoves(db, game.id)).toHaveLength(1);
  });

  it("finishes the game in the same step as the last move", async () => {
    const game = makeGame();
    await insertGame(db, game);
    await commitMove(db, {
      gameId: game.id, expectedPly: 0, move: E4, whiteMs: 1, blackMs: 1, now: NOON,
      finish: { status: "finished", result: "white", reason: "checkmate" },
    });
    expect(await getGame(db, game.id)).toMatchObject({ status: "finished", result: "white", reason: "checkmate" });
  });

  it("finishes an active game once", async () => {
    const game = makeGame();
    await insertGame(db, game);
    const end = { status: "finished", result: "black", reason: "resignation" } as const;
    expect(await finishGame(db, game.id, end)).toBe(true);
    expect(await finishGame(db, game.id, end)).toBe(false);
  });

  it("records the flagged clock when a game ends on time", async () => {
    const game = makeGame();
    await insertGame(db, game);
    await finishGame(db, game.id, { status: "finished", result: "black", reason: "timeout" }, { whiteMs: 0 });
    expect(await getGame(db, game.id)).toMatchObject({ whiteMs: 0, blackMs: 600_000 });
  });

  it("grants an AI lease to one caller only", async () => {
    const game = makeGame();
    await insertGame(db, game);
    const claims = await Promise.all([
      claimLease(db, game.id, 0, NOON, NOON + 60_000),
      claimLease(db, game.id, 0, NOON, NOON + 60_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("grants a lease again once the old one has expired", async () => {
    const game = makeGame();
    await insertGame(db, game);
    await claimLease(db, game.id, 0, NOON, NOON + 60_000);
    expect(await claimLease(db, game.id, 0, NOON + 30_000, NOON + 90_000)).toBe(false);
    expect(await claimLease(db, game.id, 0, NOON + 60_000, NOON + 120_000)).toBe(true);
  });

  it("does not grant a lease for a ply that has passed", async () => {
    const game = makeGame({ ply: 3 });
    await insertGame(db, game);
    expect(await claimLease(db, game.id, 2, NOON, NOON + 60_000)).toBe(false);
  });

  it("renews a lease only for the caller that holds it", async () => {
    const game = makeGame();
    await insertGame(db, game);
    await claimLease(db, game.id, 0, NOON, NOON + 60_000);
    expect(await renewLease(db, game.id, 0, NOON + 60_000, NOON + 200_000)).toBe(true);
    expect((await getGame(db, game.id))?.aiLeaseUntil).toBe(NOON + 200_000);
    expect(await renewLease(db, game.id, 0, NOON + 60_000, NOON + 300_000)).toBe(false);
    expect((await getGame(db, game.id))?.aiLeaseUntil).toBe(NOON + 200_000);
  });

  it("does not finish a game that has moved past the ply the caller saw", async () => {
    const game = makeGame({ ply: 2 });
    await insertGame(db, game);
    const end = { status: "aborted", result: null, reason: "provider_error" } as const;
    expect(await finishGame(db, game.id, end, { expectedPly: 1 })).toBe(false);
    expect((await getGame(db, game.id))?.status).toBe("active");
    expect(await finishGame(db, game.id, end, { expectedPly: 2 })).toBe(true);
  });

  it("counts failed attempts for the lease holder and clears them when a move is played", async () => {
    const game = makeGame();
    await insertGame(db, game);
    await claimLease(db, game.id, 0, NOON, NOON + 60_000);
    expect(await recordAttempt(db, game.id, 0, NOON + 60_000, "invalid")).toEqual({ invalid: 1, failures: 0 });
    expect(await recordAttempt(db, game.id, 0, NOON + 60_000, "provider_error")).toEqual({ invalid: 1, failures: 1 });
    expect(await recordAttempt(db, game.id, 0, NOON + 99_000, "invalid")).toBeNull();
    await commitMove(db, { gameId: game.id, expectedPly: 0, move: E4, whiteMs: 1, blackMs: 1, now: NOON });
    await claimLease(db, game.id, 1, NOON, NOON + 60_000);
    expect(await recordAttempt(db, game.id, 1, NOON + 60_000, "invalid")).toEqual({ invalid: 1, failures: 0 });
  });

  it("ends games whose mover ran out of time while nobody was watching", async () => {
    const playerLate = makeGame({ whiteMs: 60_000 });
    const aiLate = makeGame({ ply: 1, blackMs: 30_000, playerId: "p2" });
    const inTime = makeGame({ whiteMs: 600_000, playerId: "p3" });
    const done = makeGame({ status: "finished", result: "draw", reason: "stalemate", whiteMs: 1, playerId: "p4" });
    for (const g of [playerLate, aiLate, inTime, done]) await insertGame(db, g);
    expect(await expireOverdue(db, NOON + 60_000)).toBe(2);
    expect(await getGame(db, playerLate.id)).toMatchObject({ status: "finished", result: "black", reason: "timeout", whiteMs: 0 });
    expect(await getGame(db, aiLate.id)).toMatchObject({ status: "finished", result: "white", reason: "timeout", blackMs: 0 });
    expect((await getGame(db, inTime.id))?.status).toBe("active");
    expect(await getGame(db, done.id)).toMatchObject({ result: "draw", whiteMs: 1 });
  });

  it("counts a day's games by player, network and overall, ignoring aborted ones", async () => {
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x" }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "y", status: "finished" }));
    await insertGame(db, makeGame({ playerId: "b", ipHash: "x" }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x", status: "aborted" }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x", day: "2026-10-08" }));
    expect(await countForDay(db, "2026-10-09", "a", "x")).toEqual({ global: 3, player: 2, ip: 2 });
  });

  it("finds a player's active game", async () => {
    const done = makeGame({ status: "finished" });
    const live = makeGame();
    await insertGame(db, done);
    await insertGame(db, live);
    expect((await activeGameFor(db, "player-1"))?.id).toBe(live.id);
    expect(await activeGameFor(db, "someone-else")).toBeNull();
  });

  it("lists live games before finished ones, newest first", async () => {
    const old = makeGame({ status: "finished", createdAt: NOON - 5_000 });
    const recent = makeGame({ status: "finished", createdAt: NOON });
    const live = makeGame({ createdAt: NOON - 9_000 });
    for (const g of [old, recent, live]) await insertGame(db, g);
    expect((await listGames(db, 50)).map((g) => g.id)).toEqual([live.id, recent.id, old.id]);
  });
});

describe("connections", () => {
  it("stores, replaces, lists and removes a secret", async () => {
    await putConnection(db, "gemini", "blob-1", NOON);
    await putConnection(db, "gemini", "blob-2", NOON + 1);
    expect(await getConnection(db, "gemini")).toEqual({ provider: "gemini", secret: "blob-2", updatedAt: NOON + 1 });
    expect(await listConnections(db)).toEqual([{ provider: "gemini", updatedAt: NOON + 1 }]);
    await deleteConnection(db, "gemini");
    expect(await getConnection(db, "gemini")).toBeNull();
  });
});

describe("models", () => {
  it("adds, updates and removes a model", async () => {
    const row = { provider: "openrouter", modelId: "x/y:free", label: "Y", supportsEffort: false, enabled: true } as const;
    await upsertModel(db, row);
    await upsertModel(db, { ...row, enabled: false });
    expect(await listModelRows(db)).toEqual([{ ...row, enabled: false }]);
    await deleteModel(db, "openrouter", "x/y:free");
    expect(await listModelRows(db)).toEqual([]);
  });
});

describe("rate limit", () => {
  it("allows up to the limit inside a window", async () => {
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await hitRateLimit(db, "k", 3, 60_000, NOON + i));
    expect(hits).toEqual([true, true, true, false]);
  });

  it("starts again after the window has passed", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit(db, "k", 3, 60_000, NOON);
    expect(await hitRateLimit(db, "k", 3, 60_000, NOON + 60_000)).toBe(true);
  });

  it("counts keys separately", async () => {
    await hitRateLimit(db, "a", 1, 60_000, NOON);
    expect(await hitRateLimit(db, "b", 1, 60_000, NOON)).toBe(true);
  });
});
