import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { makeGame, NOON } from "@/test/factory";
import { FAST, PAID, SLOW, harness, meterAt, type Reply } from "@/test/game";
import { ARENA } from "../config";
import type { Db } from "../db/client";
import { expireOverdue, getGame, insertGame, listMoves } from "../db/games";
import { listModelRatings } from "../db/ratings";
import { gameCounts } from "../db/usage";
import { getGameView } from "../game/state";
import type { Game } from "../game/types";
import type { OfferedModel } from "../owner/catalog";
import {
  ARENA_PLAYER, arenaGamesPerDay, driveArenaGame, runArena, setArenaGamesPerDay, sittingOut, startArenaGame,
} from "./run";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const FAST_TWO: OfferedModel = { ...FAST, id: "fake-2", label: "Scripted Two" };
const MINUTE = 60_000;
const FOOLS_MATE = ["f3", "e5", "g4", "Qh4#"];

const arena = (replies: Reply[] = [], entrants: OfferedModel[] = [FAST, FAST_TWO]) =>
  harness(db, replies, { entrants: async () => entrants });

async function started(h: ReturnType<typeof arena>, options?: { ignoreBudget?: boolean }): Promise<Game> {
  const result = await startArenaGame(h.deps, options);
  if (!result.ok) throw new Error(result.reason);
  return result.game;
}

/** An arena game that has already ended, for filling the day or the record. */
const past = (overrides: Partial<Game> = {}): Game =>
  makeGame({
    playerId: ARENA_PLAYER, model: "fake-2", timeControl: "3+0", status: "finished", result: "white", reason: "checkmate",
    rival: { provider: "fake", model: "fake-1", modelLabel: "Scripted", effort: null },
    ...overrides,
  });

describe("startArenaGame", () => {
  it("seats two models at the pool's time control, with nobody's daily limit touched", async () => {
    const h = arena();
    const game = await started(h);
    expect(game).toMatchObject({
      playerId: ARENA_PLAYER, timeControl: ARENA.timeControls.bullet, playerColor: "white", status: "active",
      whiteMs: 60_000, blackMs: 60_000,
    });
    expect([game.rival!.model, game.model].sort()).toEqual(["fake-1", "fake-2"]);
    expect(await getGame(db, game.id)).toEqual(game);
    expect(await gameCounts(db, game.day, ARENA_PLAYER, ARENA_PLAYER, NOON)).toMatchObject([{ total: 0, player: 0, ip: 0, active: 1 }]);
  });

  it("plays a model with effort levels at the arena's effort, in the pool it can play", async () => {
    const game = await started(arena([], [FAST, SLOW]));
    expect(game.timeControl).toBe(ARENA.timeControls.regular);
    const slow = game.model === "gpt-a" ? game : game.rival!;
    expect(slow.effort).toBe(ARENA.effort);
  });

  it("plays a model that is too slow at the arena's effort at low", async () => {
    const grok: OfferedModel = { ...SLOW, provider: "grok", id: "grok-4.7", label: "Grok 4.7" };
    const game = await started(arena([], [grok, SLOW]));
    const seat = game.model === "grok-4.7" ? game : game.rival!;
    expect(seat.effort).toBe("low");
  });

  it("runs one game at a time", async () => {
    const h = arena();
    await started(h);
    expect(await startArenaGame(h.deps)).toEqual({ ok: false, reason: "running" });
  });

  it("stops at the day's budget, which the owner can change, and starts again the next day", async () => {
    const h = arena();
    expect(await arenaGamesPerDay(db)).toBe(ARENA.gamesPerDay);
    await setArenaGamesPerDay(db, 1);
    await insertGame(db, past());
    expect(await startArenaGame(h.deps)).toEqual({ ok: false, reason: "budget" });
    expect((await startArenaGame(h.deps, { ignoreBudget: true })).ok).toBe(true);
    await resetDb(db);
    await setArenaGamesPerDay(db, 1);
    await insertGame(db, past({ day: "2026-10-08" }));
    expect((await startArenaGame(h.deps)).ok).toBe(true);
  });

  it("is switched off by a budget of zero", async () => {
    await setArenaGamesPerDay(db, 0);
    expect(await startArenaGame(arena().deps)).toEqual({ ok: false, reason: "budget" });
  });

  it("needs two models that share a pool", async () => {
    expect(await startArenaGame(arena([], [FAST]).deps)).toEqual({ ok: false, reason: "no_pairing" });
    expect(await startArenaGame(arena([], []).deps)).toEqual({ ok: false, reason: "no_pairing" });
  });

  it("leaves out a model whose budget has nothing to spare", async () => {
    // Jev has spent today's ten cents, so the scripted model has nobody to play.
    await db.query("INSERT INTO usage (day, provider, model, calls, input_tokens) VALUES ('2026-10-09', 'jev', 'jev-latest', 1600, 2400000)");
    expect(await startArenaGame(arena([], [FAST, PAID]).deps)).toEqual({ ok: false, reason: "no_pairing" });
    await db.query("DELETE FROM usage");
    expect((await startArenaGame(arena([], [FAST, PAID]).deps)).ok).toBe(true);
  });

  it("leaves a budget's games for the players who usually use them", async () => {
    const metered = (usedPercent: number) => {
      const meter = async () => ({ value: meterAt(usedPercent), readAt: NOON, error: null });
      return harness(db, [], { entrants: async () => [SLOW, { ...SLOW, id: "gpt-b", label: "GPT B" }], usage: { meter, openRouterCap: async () => 1000 } });
    };
    // Players have started a game a day against the subscription, and half of today is left: one game is theirs.
    for (let i = 0; i < 7; i++) {
      await insertGame(db, makeGame({ provider: "codex", model: "gpt-a", status: "finished", ply: 80, day: "2026-10-08", createdAt: NOON - 86_400_000 }));
    }
    // Both models draw on the one meter, so a game between them needs room for two.
    expect(await startArenaGame(metered(23).deps)).toEqual({ ok: false, reason: "no_pairing" });
    expect((await startArenaGame(metered(22).deps)).ok).toBe(true);
  });

  it("counts a game that was called off after moves were played, since those were paid for", async () => {
    await setArenaGamesPerDay(db, 1);
    await insertGame(db, past({ status: "aborted", result: null, reason: "provider_error", ply: 31 }));
    expect(await startArenaGame(arena().deps)).toEqual({ ok: false, reason: "budget" });
  });

  it("calls off the live game when the arena is switched off, and blames no model for it", async () => {
    const h = arena(FOOLS_MATE);
    const game = await started(h);
    await setArenaGamesPerDay(db, 0);
    expect(await getGame(db, game.id)).toMatchObject({ status: "aborted", result: null, reason: "called_off" });
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE)).toBe("over");
    expect(h.requests).toHaveLength(0);
    // Switched back on, both models are still in the field.
    await setArenaGamesPerDay(db, 2);
    expect((await startArenaGame(h.deps)).ok).toBe(true);
  });

  it("does not count a game that was called off before its first move, and rests the model that could not answer", async () => {
    await setArenaGamesPerDay(db, 1);
    // Called off on white's first move: white is the rival, fake-1.
    await insertGame(db, past({ status: "aborted", result: null, reason: "provider_error", ply: 0 }));
    const third: OfferedModel = { ...FAST, id: "fake-3", label: "Scripted Three" };
    const game = await started(arena([], [FAST, FAST_TWO, third]));
    expect([game.rival!.model, game.model].sort()).toEqual(["fake-2", "fake-3"]);
    await resetDb(db);
    await insertGame(db, past({ status: "aborted", result: null, reason: "provider_error", ply: 0 }));
    expect(await startArenaGame(arena().deps)).toEqual({ ok: false, reason: "no_pairing" });
  });

  it("pairs the models that have met least", async () => {
    const third: OfferedModel = { ...FAST, id: "fake-3", label: "Scripted Three" };
    await insertGame(db, past({ day: "2026-10-08" }));
    const game = await started(arena([], [FAST, FAST_TWO, third]));
    expect([game.rival!.model, game.model]).toContain("fake-3");
  });
});

describe("driveArenaGame", () => {
  it("plays both sides to the end of the game", async () => {
    const h = arena(FOOLS_MATE);
    const game = await started(h);
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE)).toBe("over");
    expect((await listMoves(db, game.id)).map((m) => m.san)).toEqual(FOOLS_MATE);
    expect(await getGame(db, game.id)).toMatchObject({ status: "finished", result: "black", reason: "checkmate" });
    expect(h.requests.map((r) => r.model)).toEqual([game.rival!.model, game.model, game.rival!.model, game.model]);
  });

  it("charges each model only for the time it spent thinking", async () => {
    const think: Reply = (request, clock) => {
      clock.now += 4_000;
      return { kind: "move", san: FOOLS_MATE[request.history.length] };
    };
    const h = arena([think]);
    const game = await started(h);
    // An hour passes before any run picks the game up, and nobody is charged for it.
    h.clock.now += 60 * MINUTE;
    expect(await expireOverdue(db, h.clock.now)).toBe(0);
    await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE);
    expect(await getGame(db, game.id)).toMatchObject({ status: "finished", whiteMs: 52_000, blackMs: 52_000 });
    expect(h.requests.map((r) => r.remainingMs)).toEqual([60_000, 60_000, 56_000, 56_000]);
  });

  it("stops while there is no room for another call, and carries on in the next run", async () => {
    const h = arena(FOOLS_MATE);
    const game = await started(h);
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + 9_999)).toBe("out_of_time");
    expect(h.requests).toHaveLength(0);
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE)).toBe("over");
  });

  it("leaves a turn that another run is already playing", async () => {
    const h = arena(FOOLS_MATE);
    const game = await started(h);
    await db.query("UPDATE games SET ai_lease_until = $2 WHERE id = $1", [game.id, new Date(h.clock.now + 5_000)]);
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE)).toBe("busy");
    expect(h.requests).toHaveLength(0);
  });

  it("gives the game to the other side when a model cannot find a legal move", async () => {
    const h = arena([{ kind: "invalid", raw: "Ke9" }]);
    const game = await started(h);
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE)).toBe("over");
    expect(await getGame(db, game.id)).toMatchObject({ status: "finished", result: "black", reason: "illegal_move" });
  });

  it("calls off a game when a model cannot be reached", async () => {
    const h = arena([{ kind: "provider_error", message: "HTTP 429" }]);
    const game = await started(h);
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE)).toBe("over");
    expect(await getGame(db, game.id)).toMatchObject({
      status: "aborted", result: null, reason: "provider_error", aiError: "HTTP 429",
    });
    // The model that was asked sits out, and the owner can see what stopped it.
    const { provider, model } = game.rival!;
    expect(await sittingOut(db, game.day)).toEqual([{ provider, model, why: "HTTP 429" }]);
  });

  it("calls a draw once a game has gone on too long", async () => {
    const h = arena();
    const game = past({ status: "active", result: null, reason: null, ply: ARENA.maxPlies });
    await insertGame(db, game);
    expect(await driveArenaGame(h.deps, game.id, h.clock.now + MINUTE)).toBe("over");
    expect(await getGame(db, game.id)).toMatchObject({ status: "finished", result: "draw", reason: "move_limit" });
    expect(h.requests).toHaveLength(0);
  });
});

describe("runArena", () => {
  const deadline = NOON + 10 * MINUTE;

  it("starts a game, plays it and rates both models", async () => {
    const h = arena(FOOLS_MATE);
    const run = await runArena(h.deps, { start: true, deadline });
    expect(run.state).toBe("over");
    const game = (await getGame(db, run.gameId!))!;
    expect(game.rated).toBe(true);
    const ratings = await listModelRatings(db);
    const winner = ratings.find((r) => r.key === `fake/${game.model}`)!;
    const loser = ratings.find((r) => r.key === `fake/${game.rival!.model}`)!;
    expect(ratings.map((r) => [r.pool, r.games])).toEqual([["bullet", 1], ["bullet", 1]]);
    expect(winner.rating).toBeGreaterThan(loser.rating);
    expect(game.rating).toEqual({
      playerBefore: 700, playerAfter: loser.rating, aiBefore: 700, aiAfter: winner.rating,
    });
  });

  it("carries on with a live game instead of starting another", async () => {
    const h = arena(FOOLS_MATE);
    const game = await started(h);
    expect(await runArena(h.deps, { start: true, deadline })).toEqual({ gameId: game.id, state: "over" });
  });

  it("starts nothing when it is only asked to carry on", async () => {
    const h = arena(FOOLS_MATE);
    expect(await runArena(h.deps, { start: false, deadline })).toEqual({ gameId: null, state: "idle" });
    expect(h.requests).toHaveLength(0);
  });

  it("does nothing once the day's games have been played", async () => {
    await setArenaGamesPerDay(db, 0);
    expect(await runArena(arena(FOOLS_MATE).deps, { start: true, deadline })).toEqual({ gameId: null, state: "idle" });
  });
});

describe("watching an arena game", () => {
  it("lets anyone watch, names both models, and does not run the game for them", async () => {
    const h = arena(FOOLS_MATE);
    const game = await started(h);
    h.clock.now += 5 * MINUTE;
    const view = await getGameView(h.deps, game.id, { owner: false });
    expect(view).toMatchObject({
      status: "active", modelLabel: game.modelLabel, rival: { label: game.rival!.modelLabel, effort: null },
      whiteMs: 60_000, blackMs: 60_000,
    });
    expect(h.jobs).toHaveLength(0);
  });
});
