import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pausingAfter, resetDb, testDb } from "@/test/db";
import { NOON, START_FEN } from "@/test/factory";
import { harness, input } from "@/test/game";
import { LIMITS } from "../config";
import type { Db } from "../db/client";
import { finishGame, getGame } from "../db/games";
import { createGame } from "./create";
import { capacity } from "./limits";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

/** Creates a game and immediately ends it, so it counts but is not "active". */
async function playOne(h: ReturnType<typeof harness>, overrides = {}) {
  const created = await createGame(h.deps, input(overrides));
  if (created.ok) await finishGame(db, created.game.id, { status: "finished", result: "draw", reason: "stalemate" });
  return created;
}

describe("createGame", () => {
  it("starts a game with full clocks and white to move", async () => {
    const h = harness(db);
    const created = await createGame(h.deps, input({ timeControl: "2+1" }));
    expect(created.ok && created.game).toMatchObject({
      playerId: "player-1", ipHash: "ip-1", day: "2026-10-09", provider: "fake", model: "fake-1",
      modelLabel: "Scripted", effort: null, timeControl: "2+1", initialMs: 120_000, incrementMs: 1_000,
      playerColor: "white", fen: START_FEN, ply: 0, whiteMs: 120_000, blackMs: 120_000,
      turnStartedAt: NOON, status: "active", createdAt: NOON,
    });
    expect(h.requests).toHaveLength(0);
  });

  it("rejects a model that is not on offer", async () => {
    const h = harness(db);
    expect(await createGame(h.deps, input({ model: "nope" }))).toEqual({ ok: false, error: "unknown_model" });
  });

  it("rejects a time control the opponent does not offer", async () => {
    const h = harness(db);
    const bullet = input({ provider: "codex", model: "gpt-a", effort: "low", timeControl: "1+0" });
    expect(await createGame(h.deps, bullet)).toEqual({ ok: false, error: "bad_time_control" });
    expect(await createGame(h.deps, input({ timeControl: "7+7" }))).toEqual({ ok: false, error: "bad_time_control" });
  });

  it("keeps the chosen effort for a model that supports it, defaulting to medium", async () => {
    const h = harness(db);
    const high = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "high" }));
    expect(high.ok && high.game.effort).toBe("high");
    const unset = await createGame(h.deps, input({ playerId: "p2", provider: "codex", model: "gpt-a", effort: null }));
    expect(unset.ok && unset.game.effort).toBe("medium");
  });

  it("drops effort for a model that has none", async () => {
    const h = harness(db);
    const created = await createGame(h.deps, input({ effort: "high" }));
    expect(created.ok && created.game.effort).toBeNull();
  });

  it("picks a side when the player asks for random", async () => {
    const white = await createGame(harness(db, [], { random: () => 0.2 }).deps, input({ color: "random" }));
    expect(white.ok && white.game.playerColor).toBe("white");
    const black = await createGame(harness(db, [], { random: () => 0.7 }).deps, input({ playerId: "p2", color: "random" }));
    expect(black.ok && black.game.playerColor).toBe("black");
  });

  it("lets a fast AI make the first move before returning when the player has black", async () => {
    const h = harness(db, ["e4"]);
    const created = await createGame(h.deps, input({ color: "black" }));
    expect(created.ok && (await getGame(db, created.game.id))).toMatchObject({ ply: 1, playerColor: "black" });
  });

  it("schedules a slow AI's first move without waiting for it", async () => {
    const h = harness(db, ["d4"]);
    const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low", color: "black" }));
    expect(created.ok && created.game.ply).toBe(0);
    expect(h.jobs).toHaveLength(1);
    await h.runJobs();
    expect(created.ok && (await getGame(db, created.game.id))?.ply).toBe(1);
  });

  it("refuses a second game while one is in progress", async () => {
    const h = harness(db);
    const first = await createGame(h.deps, input());
    expect(await createGame(h.deps, input())).toEqual({
      ok: false, error: "active_game", activeGameId: first.ok && first.game.id,
    });
  });

  it("does not let a game the player abandoned and lost on time block a new one", async () => {
    const h = harness(db);
    const first = await createGame(h.deps, input({ timeControl: "1+0" }));
    h.clock.now += 61_000;
    const second = await createGame(h.deps, input());
    expect(second.ok).toBe(true);
    expect(first.ok && (await getGame(db, first.game.id))).toMatchObject({ status: "finished", reason: "timeout" });
  });

  it("allows a player five games a day and refuses the sixth", async () => {
    const h = harness(db);
    for (let i = 0; i < LIMITS.playerPerDay; i++) expect((await playOne(h)).ok).toBe(true);
    expect(await createGame(h.deps, input())).toEqual({ ok: false, error: "player_limit" });
  });

  it("allows a network ten games a day and refuses the eleventh", async () => {
    const h = harness(db);
    for (let i = 0; i < LIMITS.ipPerDay; i++) expect((await playOne(h, { playerId: `p${i}` })).ok).toBe(true);
    expect(await createGame(h.deps, input({ playerId: "one-more" }))).toEqual({ ok: false, error: "network_limit" });
  });

  it("allows twelve games a day overall and refuses the thirteenth", async () => {
    const h = harness(db);
    for (let i = 0; i < LIMITS.globalPerDay; i++) expect((await playOne(h, { playerId: `p${i}`, ipHash: `i${i}` })).ok).toBe(true);
    expect(await createGame(h.deps, input({ playerId: "late", ipHash: "new" }))).toEqual({ ok: false, error: "global_limit" });
  });

  it("gives out only the last slot when two visitors ask at once", async () => {
    const h = harness(db);
    for (let i = 0; i < LIMITS.globalPerDay - 1; i++) await playOne(h, { playerId: `p${i}`, ipHash: `i${i}` });
    // Each request lingers between counting the day's games and adding its own.
    const racing = { ...h.deps, db: pausingAfter(db, /count\(\*\)/) };
    const results = await Promise.all([
      createGame(racing, input({ playerId: "x", ipHash: "ix" })),
      createGame(racing, input({ playerId: "y", ipHash: "iy" })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "global_limit" });
  });

  it("returns the slot when a game is aborted", async () => {
    const h = harness(db);
    const created = await createGame(h.deps, input());
    await finishGame(db, created.ok ? created.game.id : "", { status: "aborted", result: null, reason: "provider_error" });
    expect((await capacity(db, "player-1", "ip-1", NOON)).player.used).toBe(0);
  });

  it("counts a game made at 23:59 Pacific toward that day only", async () => {
    const h = harness(db);
    h.clock.now = Date.UTC(2026, 9, 10, 6, 59);
    for (let i = 0; i < LIMITS.playerPerDay; i++) await playOne(h);
    expect((await createGame(h.deps, input())).ok).toBe(false);
    h.clock.now = Date.UTC(2026, 9, 10, 7, 0);
    const next = await createGame(h.deps, input());
    expect(next.ok && next.game.day).toBe("2026-10-10");
  });
});
