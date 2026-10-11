import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { makeGame, NOON } from "@/test/factory";
import { createPgliteDb, createPostgresDb, explicitSslMode, type Db } from "./client";
import { deleteConnection, getConnection, listConnections, putConnection } from "./connections";
import {
  activeGameFor, claimGames, claimLease, commitMove, expireOverdue, finishGame, getGame, insertGame,
  listGames, listGamesFor, listMoves, recordAttempt, renewLease, tallyFor,
} from "./games";
import { deleteModel, listModelRows, upsertModel } from "./models";
import { hitRateLimit } from "./rate-limit";
import { migrate } from "./schema";
import { getSettings, setSetting } from "./settings";
import { averagePlies, gameCounts, playersSince, recordUsage, usageSince } from "./usage";
import { findUserByEmail, getUser, insertUser } from "./users";

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

describe("explicitSslMode", () => {
  it("spells out full certificate checking where the driver already applies it", () => {
    expect(explicitSslMode("postgres://u:p@host/db?sslmode=require")).toBe("postgres://u:p@host/db?sslmode=verify-full");
    expect(explicitSslMode("postgres://u:p@host/db?a=1&sslmode=prefer&b=2")).toBe(
      "postgres://u:p@host/db?a=1&sslmode=verify-full&b=2",
    );
  });

  it("leaves other connection strings alone", () => {
    for (const url of ["postgres://u@127.0.0.1:5432/db", "postgres://u@h/db?sslmode=disable", "postgres://u@h/db?sslmode=verify-full"]) {
      expect(explicitSslMode(url)).toBe(url);
    }
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

  it("counts a day's games against each model by player, network and overall, ignoring aborted ones", async () => {
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x" }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "y", status: "finished" }));
    await insertGame(db, makeGame({ playerId: "b", ipHash: "x" }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x", status: "aborted" }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x", day: "2026-10-08", status: "finished" }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x", provider: "jev", model: "jev-latest", status: "finished" }));
    await insertGame(db, makeGame({ playerId: "c", ipHash: "z", day: "2026-09-20", createdAt: NOON - 19 * 86_400_000, status: "finished" }));
    const counts = await gameCounts(db, "2026-10-09", "a", "x", NOON - 7 * 86_400_000);
    expect(counts.sort((one, two) => one.provider.localeCompare(two.provider))).toEqual([
      { provider: "fake", model: "fake-1", total: 3, player: 2, ip: 2, active: 2, earlier: 1 },
      { provider: "jev", model: "jev-latest", total: 1, player: 1, ip: 1, active: 0, earlier: 0 },
    ]);
  });

  it("counts a game still being played wherever it started, but an arena game toward no player", async () => {
    const rival = { provider: "fake", model: "fake-2", modelLabel: "Rehearsed", effort: null } as const;
    await insertGame(db, makeGame({ playerId: "arena", ipHash: "arena", rival }));
    await insertGame(db, makeGame({ playerId: "a", ipHash: "x", day: "2026-10-08" }));
    expect(await gameCounts(db, "2026-10-09", "a", "x", NOON + 1)).toEqual([
      { provider: "fake", model: "fake-1", total: 0, player: 0, ip: 0, active: 2, earlier: 0 },
    ]);
  });

  it("counts the day's players, and the player-days of the week before", async () => {
    const DAY = 86_400_000;
    for (const playerId of ["a", "a", "b"]) await insertGame(db, makeGame({ playerId }));
    await insertGame(db, makeGame({ playerId: "c", status: "aborted" }));
    for (const playerId of ["a", "c"]) await insertGame(db, makeGame({ playerId, day: "2026-10-08", createdAt: NOON - DAY }));
    await insertGame(db, makeGame({ playerId: "a", day: "2026-10-06", createdAt: NOON - 3 * DAY }));
    await insertGame(db, makeGame({ playerId: "a", day: "2026-09-30", createdAt: NOON - 9 * DAY }));
    expect(await playersSince(db, "2026-10-09", NOON - 7 * DAY)).toEqual({ today: 2, earlier: 3 });
    expect(await playersSince(db, "2026-10-12", NOON + 1)).toEqual({ today: 0, earlier: 0 });
  });

  it("averages the length of each model's finished games", async () => {
    for (const ply of [40, 60]) await insertGame(db, makeGame({ status: "finished", ply }));
    await insertGame(db, makeGame({ status: "aborted", ply: 2 }));
    await insertGame(db, makeGame({ status: "finished", ply: 300, createdAt: NOON - 30 * 86_400_000 }));
    expect(await averagePlies(db, NOON - 7 * 86_400_000)).toEqual([{ provider: "fake", model: "fake-1", plies: 50 }]);
  });

  it("adds up a model's calls and tokens for each day", async () => {
    const jev = { provider: "jev", model: "jev-latest" } as const;
    await recordUsage(db, "2026-10-09", jev, 400);
    await recordUsage(db, "2026-10-09", jev, 0);
    await recordUsage(db, "2026-10-08", jev, 50);
    await recordUsage(db, "2026-10-01", jev, 50);
    expect((await usageSince(db, "2026-10-08")).sort((one, two) => one.day.localeCompare(two.day))).toEqual([
      { day: "2026-10-08", ...jev, calls: 1, tokens: 50 },
      { day: "2026-10-09", ...jev, calls: 2, tokens: 400 },
    ]);
  });

  it("finds stored settings by the start of their key", async () => {
    await setSetting(db, "pause:openrouter", "1");
    await setSetting(db, "pause:gemini/x", "2");
    await setSetting(db, "other", "3");
    expect(await getSettings(db, "pause:")).toEqual(new Map([["openrouter", "1"], ["gemini/x", "2"]]));
  });

  it("restarts the turn's clock with a lease when asked to", async () => {
    const game = makeGame();
    await insertGame(db, game);
    expect(await claimLease(db, game.id, 0, NOON + 9_000, NOON + 20_000)).toBe(true);
    expect((await getGame(db, game.id))?.turnStartedAt).toBe(NOON);
    expect(await claimLease(db, game.id, 0, NOON + 30_000, NOON + 40_000, true)).toBe(true);
    expect(await getGame(db, game.id)).toMatchObject({ turnStartedAt: NOON + 30_000, aiLeaseUntil: NOON + 40_000 });
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
    expect(await listModelRows(db)).toEqual([{ ...row, enabled: false, arena: null }]);
    await deleteModel(db, "openrouter", "x/y:free");
    expect(await listModelRows(db)).toEqual([]);
  });

  it("keeps a model's place in the arena when the rest of it is saved again", async () => {
    const row = { provider: "codex", modelId: "gpt-a", label: "GPT A", supportsEffort: true, enabled: true } as const;
    await upsertModel(db, { ...row, arena: true });
    await upsertModel(db, { ...row, enabled: false });
    expect(await listModelRows(db)).toEqual([{ ...row, enabled: false, arena: true }]);
    await upsertModel(db, { ...row, arena: false });
    expect((await listModelRows(db))[0].arena).toBe(false);
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

describe("users", () => {
  const ada = { id: "3f0c2f6e-5b1a-4c8e-9d2a-7e6f5a4b3c2d", email: "ada@example.com", passwordHash: "hash-1", createdAt: NOON };

  // A new account has said nothing about its strength and has played nothing.
  const fresh = { level: null, ratings: { bullet: null, regular: null }, games: { bullet: 0, regular: 0 } };

  it("round-trips a user by email and by id", async () => {
    expect(await insertUser(db, ada)).toBe(true);
    expect(await findUserByEmail(db, "ada@example.com")).toEqual({ ...ada, ...fresh });
    expect(await getUser(db, ada.id)).toEqual({ ...ada, ...fresh });
  });

  it("stores the strength a user gave when signing up", async () => {
    await insertUser(db, ada, { level: "advanced", ratings: { regular: 1900, bullet: 1800 } });
    expect(await getUser(db, ada.id)).toMatchObject({ level: "advanced", ratings: { regular: 1900, bullet: 1800 } });
  });

  it("returns null for an unknown user", async () => {
    expect(await findUserByEmail(db, "nobody@example.com")).toBeNull();
    expect(await getUser(db, ada.id)).toBeNull();
  });

  it("refuses a second user with the same email and keeps the first", async () => {
    await insertUser(db, ada);
    const second = { ...ada, id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", passwordHash: "hash-2" };
    expect(await insertUser(db, second)).toBe(false);
    expect(await findUserByEmail(db, "ada@example.com")).toMatchObject(ada);
  });
});

describe("a player's games", () => {
  const finished = (overrides: Parameters<typeof makeGame>[0]) => makeGame({ status: "finished", reason: "checkmate", ...overrides });

  it("moves one player's games to another and leaves the rest alone", async () => {
    const mine = [makeGame({ playerId: "guest" }), finished({ playerId: "guest", result: "white" })];
    const theirs = makeGame({ playerId: "someone-else" });
    for (const game of [...mine, theirs]) await insertGame(db, game);
    expect(await claimGames(db, "guest", "account")).toBe(2);
    expect((await getGame(db, mine[0].id))!.playerId).toBe("account");
    expect((await getGame(db, mine[1].id))!.playerId).toBe("account");
    expect((await getGame(db, theirs.id))!.playerId).toBe("someone-else");
  });

  it("lists only that player's games, live first and then the most recent", async () => {
    const old = finished({ result: "white", createdAt: NOON });
    const recent = finished({ result: "black", createdAt: NOON + 2_000 });
    const live = makeGame({ createdAt: NOON + 1_000 });
    for (const game of [old, recent, live, makeGame({ playerId: "someone-else" })]) await insertGame(db, game);
    expect((await listGamesFor(db, "player-1", 10)).map((g) => g.id)).toEqual([live.id, recent.id, old.id]);
    expect(await listGamesFor(db, "player-1", 2)).toHaveLength(2);
  });

  it("tallies finished games by model, time control and colour", async () => {
    const games = [
      finished({ result: "white" }),
      finished({ result: "black" }),
      finished({ result: "draw", reason: "stalemate" }),
      finished({ playerColor: "black", result: "black", timeControl: "5+0", modelLabel: "Other" }),
    ];
    for (const game of games) await insertGame(db, game);
    const tallies = await tallyFor(db, "player-1");
    expect(tallies).toHaveLength(2);
    expect(tallies).toContainEqual({ modelLabel: "Fake", timeControl: "10+10", playerColor: "white", played: 3, won: 1, drawn: 1 });
    expect(tallies).toContainEqual({ modelLabel: "Other", timeControl: "5+0", playerColor: "black", played: 1, won: 1, drawn: 0 });
  });

  it("leaves live and aborted games, and other players' games, out of the tally", async () => {
    const ignored = [
      makeGame(),
      makeGame({ status: "aborted", reason: "provider_error" }),
      finished({ playerId: "someone-else", result: "white" }),
    ];
    for (const game of ignored) await insertGame(db, game);
    expect(await tallyFor(db, "player-1")).toEqual([]);
  });
});
