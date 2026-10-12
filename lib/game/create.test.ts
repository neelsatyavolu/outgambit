import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pausingAfter, resetDb, testDb } from "@/test/db";
import { NOON, START_FEN } from "@/test/factory";
import { harness, input, meterAt } from "@/test/game";
import type { Db } from "../db/client";
import { finishGame, getGame } from "../db/games";
import { gameCounts } from "../db/usage";
import { createGame, type CreateInput } from "./create";
import { dayKey } from "./limits";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

/** A game against the subscription model, whose budget is its provider's weekly meter. */
const slow = (overrides: Partial<CreateInput> = {}): CreateInput =>
  input({ provider: "codex", model: "gpt-a", effort: "low", timeControl: "20+20", ...overrides });

/** A subscription half way through its week, with this much of the allowance used. */
const metered = (usedPercent: number, shortPercent: number | null = null) => {
  const h = harness(db);
  const meter = async () => ({ value: meterAt(usedPercent, shortPercent), readAt: NOON, error: null });
  return { ...h, deps: { ...h.deps, usage: { ...h.deps.usage, meter } } };
};

/** Creates a game and immediately ends it, so it counts but is not "active". */
async function playOne(h: Pick<ReturnType<typeof harness>, "deps">, overrides: Partial<CreateInput> = {}) {
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

  it("starts the clock after loading the provider budget", async () => {
    const h = harness(db);
    h.deps.usage.meter = async () => {
      h.clock.now += 1_237;
      return { value: meterAt(0), readAt: h.clock.now, error: null };
    };
    const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
    expect(created.ok && created.game.turnStartedAt).toBe(NOON + 1_237);
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

  it("plays at low effort, whatever is asked for", async () => {
    const h = harness(db);
    const low = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
    expect(low.ok && low.game.effort).toBe("low");
    const medium = await createGame(h.deps, input({ playerId: "p2", provider: "codex", model: "gpt-a", effort: "medium" }));
    expect(medium.ok && medium.game.effort).toBe("low");
    const unset = await createGame(h.deps, input({ playerId: "p3", provider: "codex", model: "gpt-a", effort: null }));
    expect(unset.ok && unset.game.effort).toBe("low");
  });

  it("plays a model that is too slow at medium at low, whatever is asked for", async () => {
    const grok = { provider: "grok", id: "grok-4.7", label: "Grok 4.7", supportsEffort: true, timeControls: ["20+20"] } as const;
    const h = harness(db, [], { findModel: async () => ({ ...grok, timeControls: [...grok.timeControls] }) });
    const asked = { provider: "grok", model: "grok-4.7", timeControl: "20+20" } as const;
    const medium = await createGame(h.deps, input({ ...asked, effort: "medium" }));
    expect(medium.ok && medium.game.effort).toBe("low");
    const unset = await createGame(h.deps, input({ ...asked, playerId: "p2", effort: null }));
    expect(unset.ok && unset.game.effort).toBe("low");
  });

  it("drops effort for a model that has none", async () => {
    const h = harness(db);
    const created = await createGame(h.deps, input({ effort: "low" }));
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

  it("puts no limit on the scripted opponent, which costs nothing", async () => {
    const h = harness(db);
    for (let i = 0; i < 15; i++) expect((await playOne(h)).ok).toBe(true);
  });

  it("refuses a subscription model once its weekly meter has caught up with the pace", async () => {
    // Half way through the week, a quarter of the allowance may be used, and the leeway on top.
    expect((await playOne(metered(34), slow())).ok).toBe(true);
    expect(await createGame(metered(35).deps, slow())).toEqual({ ok: false, error: "no_games_left", blocked: "pace" });
  });

  it("refuses it when half its short window is used, whatever the week looks like", async () => {
    expect(await createGame(metered(0, 50).deps, slow())).toEqual({ ok: false, error: "no_games_left", blocked: "short_window" });
  });

  it("refuses it when its meter cannot be read", async () => {
    const h = harness(db, [], { usage: { ...harness(db).deps.usage, meter: async () => ({ value: null, readAt: null, error: "HTTP 401" }) } });
    expect(await createGame(h.deps, slow())).toEqual({ ok: false, error: "no_games_left", blocked: "usage_unavailable" });
  });

  it("splits a budget between the day's players", async () => {
    // Six games of headroom, and two people have already played one each.
    const h = metered(29);
    for (const playerId of ["a", "b"]) expect((await playOne(h, slow({ playerId, ipHash: playerId }))).ok).toBe(true);
    for (let i = 0; i < 3; i++) expect((await playOne(h, slow())).ok).toBe(true);
    expect(await createGame(h.deps, slow())).toEqual({ ok: false, error: "no_games_left", blocked: "player" });
    // Someone who has not played yet still gets a game.
    expect((await createGame(h.deps, slow({ playerId: "late", ipHash: "late" }))).ok).toBe(true);
  });

  it("lets one network have two players' shares and no more", async () => {
    const h = metered(29);
    for (let i = 0; i < 4; i++) expect((await playOne(h, slow({ playerId: `p${i}` }))).ok).toBe(true);
    expect(await createGame(h.deps, slow({ playerId: "one-more" }))).toEqual({ ok: false, error: "no_games_left", blocked: "network" });
  });

  it("gives out only the last game when two visitors ask at once", async () => {
    const h = metered(34);
    // Each request lingers between counting the day's games and adding its own.
    const racing = { ...h.deps, db: pausingAfter(db, /count\(\*\)/) };
    const results = await Promise.all([
      createGame(racing, slow({ playerId: "x", ipHash: "ix" })),
      createGame(racing, slow({ playerId: "y", ipHash: "iy" })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "no_games_left", blocked: "pace" });
  });

  it("returns the game to the player's share when it is aborted", async () => {
    const h = metered(0);
    const created = await createGame(h.deps, slow());
    await finishGame(db, created.ok ? created.game.id : "", { status: "aborted", result: null, reason: "provider_error" });
    expect(await gameCounts(db, dayKey(NOON), "player-1", "ip-1")).toEqual([
      { provider: "codex", model: "gpt-a", total: 0, player: 0, ip: 0, active: 0 },
    ]);
  });

  it("counts a game made at 23:59 Pacific toward that day only", async () => {
    const h = harness(db);
    h.clock.now = Date.UTC(2026, 9, 10, 6, 59);
    const late = await playOne(h);
    expect(late.ok && late.game.day).toBe("2026-10-09");
    h.clock.now = Date.UTC(2026, 9, 10, 7, 0);
    expect(await gameCounts(db, dayKey(h.clock.now), "player-1", "ip-1")).toEqual([]);
    const next = await createGame(h.deps, input());
    expect(next.ok && next.game.day).toBe("2026-10-10");
  });
});
