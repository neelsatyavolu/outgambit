import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { makeGame, NOON } from "@/test/factory";
import { meterAt } from "@/test/game";
import type { Db } from "../db/client";
import { insertGame } from "../db/games";
import type { GameCounts } from "../db/usage";
import { allowance, allowances, loadDemand, type Demand } from "./allowance";
import { budgetPool } from "./pools";
import type { Supply } from "./supply";

const supply = (left: number, overrides: Partial<Supply> = {}): Supply => ({
  pool: budgetPool("jev", "jev-latest")!, left, closed: left < 1 ? "daily_budget" : null,
  used: 0, limit: 10, resetsAt: null, readAt: null, error: null, ...overrides,
});

const jev = (counts: Partial<GameCounts>): GameCounts => ({
  provider: "jev", model: "jev-latest", total: 0, player: 0, ip: 0, active: 0, ...counts,
});

const demand = (expected: number, ...counts: GameCounts[]): Demand => ({ counts, expected, dayFractionLeft: 0.5 });

describe("allowance", () => {
  it("is null for a model with no budget", () => {
    expect(allowance(null, demand(3))).toBeNull();
  });

  it("gives a player an even share of the day's games", () => {
    // Eight played and twelve left is twenty for the day, between four players.
    expect(allowance(supply(12), demand(4, jev({ total: 8, player: 2, ip: 2 })))).toEqual({
      used: 2, limit: 5, left: 12, blocked: null,
    });
  });

  it("stops a player who has used their share", () => {
    expect(allowance(supply(12), demand(4, jev({ total: 8, player: 5, ip: 5 })))).toMatchObject({ used: 5, limit: 5, blocked: "player" });
  });

  it("stops a network that has used two shares", () => {
    expect(allowance(supply(12), demand(4, jev({ total: 12, player: 0, ip: 12 })))).toMatchObject({ limit: 6, blocked: "network" });
    expect(allowance(supply(12), demand(4, jev({ total: 12, player: 0, ip: 11 })))?.blocked).toBeNull();
  });

  it("says why the budget is closed, before anything about the player", () => {
    const closed = supply(0, { closed: "rate_limited" });
    expect(allowance(closed, demand(1, jev({ total: 3, player: 3, ip: 3 })))).toMatchObject({ left: 0, blocked: "rate_limited" });
  });

  it("holds a place for each game still being played", () => {
    expect(allowance(supply(2), demand(1, jev({ total: 1, active: 1 })))).toMatchObject({ left: 1, blocked: null });
    expect(allowance(supply(2), demand(1, jev({ total: 2, active: 2 })))).toMatchObject({ left: 0, blocked: "daily_budget" });
  });

  it("counts only the games on the same budget", () => {
    const other: GameCounts = { provider: "openai", model: "gpt-6-luna", total: 30, player: 30, ip: 30, active: 3 };
    expect(allowance(supply(12), demand(4, other))).toEqual({ used: 0, limit: 3, left: 12, blocked: null });
  });

  it("adds up the models that share a budget", () => {
    const pool = budgetPool("openrouter", "a:free")!;
    const rows: GameCounts[] = [
      { provider: "openrouter", model: "a:free", total: 2, player: 1, ip: 1, active: 0 },
      { provider: "openrouter", model: "b:free", total: 2, player: 1, ip: 1, active: 0 },
    ];
    expect(allowance(supply(4, { pool }), demand(4, ...rows))).toMatchObject({ used: 2, limit: 2, blocked: "player" });
  });
});

describe("with the day's games", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });
  beforeEach(() => resetDb(db));

  const who = { playerId: "me", ipHash: "home" };
  const played = (playerId: string, overrides = {}) =>
    insertGame(db, makeGame({ playerId, ipHash: playerId, provider: "jev", model: "jev-latest", status: "finished", ply: 80, ...overrides }));

  it("expects today's players, and as many of the usual crowd as the day has left for", async () => {
    // NOON is twelve hours into the Pacific day. Fourteen player-days in the week before is two a day.
    for (let i = 0; i < 14; i++) await played(`earlier-${i}`, { day: "2026-10-07", createdAt: NOON - 2 * 86_400_000 });
    for (const playerId of ["a", "b", "c"]) await played(playerId);
    expect((await loadDemand(db, who, NOON)).expected).toBe(4);
  });

  it("does not count the arena's old games, called-off games or old ones as players", async () => {
    await played("arena");
    await db.query("UPDATE games SET rival_model = 'fake-1' WHERE player_id = 'arena'");
    await played("quit", { status: "aborted" });
    await played("long-ago", { day: "2026-09-20", createdAt: NOON - 19 * 86_400_000 });
    expect((await loadDemand(db, who, NOON)).expected).toBe(1);
  });

  it("works out every offered model's allowance for a visitor", async () => {
    await played("me");
    await played("someone");
    const usage = { meter: async () => ({ value: meterAt(31), readAt: NOON, error: null }), openRouterCap: async () => 50 };
    const models = [
      { provider: "jev", id: "jev-latest" }, { provider: "codex", id: "gpt-a" }, { provider: "fake", id: "fake-1" },
    ] as const;
    expect(await allowances(db, usage, models, who, NOON)).toEqual({
      // 2 played and 39 left, between the two who have played.
      "jev/jev-latest": { used: 1, limit: 20, left: 39, blocked: null },
      "codex/gpt-a": { used: 0, limit: 2, left: 4, blocked: null },
      "fake/fake-1": null,
    });
  });
});
