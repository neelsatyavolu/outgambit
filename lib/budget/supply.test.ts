import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { makeGame, NOON } from "@/test/factory";
import { meterAt } from "@/test/game";
import type { Db } from "../db/client";
import { insertGame } from "../db/games";
import type { ModelRef } from "../db/usage";
import { nextResetAt } from "../game/limits";
import { pausePool, supplies, type UsageSource } from "./supply";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const TODAY = "2026-10-09";
const JEV: ModelRef = { provider: "jev", model: "jev-latest" };
const LUNA: ModelRef = { provider: "openai", model: "gpt-6-luna" };
const GPT: ModelRef = { provider: "codex", model: "gpt-a" };
const FREE_A: ModelRef = { provider: "openrouter", model: "a/one:free" };
const FREE_B: ModelRef = { provider: "openrouter", model: "b/two:free" };
const FLASH: ModelRef = { provider: "gemini", model: "gemini-3.8-flash" };
const LITE: ModelRef = { provider: "gemini", model: "gemini-3.5-flash-lite" };

const source = (overrides: Partial<UsageSource> = {}): UsageSource => ({
  meter: async () => ({ value: meterAt(10), readAt: NOON, error: null }),
  openRouterCap: async () => 1000,
  ...overrides,
});

const used = (model: ModelRef, calls: number, tokens = 0, day = TODAY) =>
  db.query("INSERT INTO usage (day, provider, model, calls, input_tokens) VALUES ($1, $2, $3, $4, $5)", [
    day, model.provider, model.model, calls, tokens,
  ]);

const one = async (model: ModelRef, usage = source()) => (await supplies(db, usage, [model], NOON))[0]!;

describe("a subscription's budget", () => {
  it("is the meter's headroom under the pace line, at a percent a game", async () => {
    expect(await one(GPT)).toEqual({
      pool: { id: "codex", kind: "meter" }, left: 15, closed: null, used: 10, limit: 25,
      resetsAt: meterAt(0).weekly.resetsAt, readAt: NOON, error: null,
    });
  });

  it("closes on pace when less than a game of headroom is left", async () => {
    const meter = async () => ({ value: meterAt(24.5), readAt: NOON, error: null });
    expect(await one(GPT, source({ meter }))).toMatchObject({ left: 0, closed: "pace" });
  });

  it("gives a week nobody has used yet one game, even before the pace line has risen", async () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const fresh = { weekly: { usedPercent: 0, resetsAt: NOON + week, lengthMs: week }, short: null };
    const meter = async () => ({ value: fresh, readAt: NOON, error: null });
    expect(await one(GPT, source({ meter }))).toMatchObject({ left: 1, closed: null, used: 0, limit: 0 });
    const started = { ...fresh, weekly: { ...fresh.weekly, usedPercent: 1 } };
    expect(await one(GPT, source({ meter: async () => ({ value: started, readAt: NOON, error: null }) }))).toMatchObject({ left: 0, closed: "pace" });
  });

  it("closes without a reading it can trust, and says what went wrong", async () => {
    const meter = async () => ({ value: null, readAt: NOON - 7_200_000, error: "HTTP 503" });
    expect(await one(GPT, source({ meter }))).toMatchObject({
      left: 0, closed: "usage_unavailable", readAt: NOON - 7_200_000, error: "HTTP 503",
    });
  });

  it("does not go by a reading from before the week reset", async () => {
    const lastWeek = { ...meterAt(30), weekly: { ...meterAt(30).weekly, resetsAt: NOON - 60_000 } };
    const meter = async () => ({ value: lastWeek, readAt: NOON - 120_000, error: null });
    expect(await one(GPT, source({ meter }))).toMatchObject({ left: 0, closed: "usage_unavailable", error: "week has reset" });
  });

  it("reads a provider's meter once, however many of its models are asked about", async () => {
    let reads = 0;
    const meter = async () => {
      reads++;
      return { value: meterAt(10), readAt: NOON, error: null };
    };
    await supplies(db, source({ meter }), [GPT, { provider: "codex", model: "gpt-b" }, JEV], NOON);
    expect(reads).toBe(1);
  });
});

describe("a free model's budget", () => {
  it("is the day's requests left, at forty calls a game until games have been played", async () => {
    await used(FREE_A, 120);
    expect(await one(FREE_A)).toEqual({
      pool: { id: "openrouter", kind: "requests" }, left: 22, closed: null, used: 120, limit: 1000,
      resetsAt: nextResetAt(NOON), readAt: null, error: null,
    });
  });

  it("has room for one game a day on OpenRouter's smaller limit, and none once that game is played", async () => {
    const small = source({ openRouterCap: async () => 50 });
    expect(await one(FREE_A, small)).toMatchObject({ left: 1, closed: null });
    await used(FREE_A, 35);
    expect(await one(FREE_A, small)).toMatchObject({ left: 0, closed: "free_limit", used: 35, limit: 50 });
  });

  it("shares OpenRouter's limit between its models, and counts only today", async () => {
    await used(FREE_A, 400);
    await used(FREE_B, 400);
    await used(FREE_A, 900, 0, "2026-10-08");
    expect(await one(FREE_B)).toMatchObject({ used: 800, left: 5 });
  });

  it("gives each Gemini model its own limit", async () => {
    await used(FLASH, 90);
    expect(await one(FLASH)).toMatchObject({ pool: { id: "gemini/gemini-3.8-flash" }, used: 90, limit: 100, left: 0, closed: "free_limit" });
    expect(await one(LITE)).toMatchObject({ used: 0, left: 2, closed: null });
  });

  it("counts on a game taking as many calls as the model's recent games did", async () => {
    for (const ply of [50, 70]) await insertGame(db, makeGame({ ...FREE_A, status: "finished", ply }));
    await insertGame(db, makeGame({ ...FREE_A, status: "aborted", ply: 2 }));
    // Sixty plies on average is thirty calls by the model.
    expect(await one(FREE_A)).toMatchObject({ left: 33 });
  });

  it("never counts on fewer than ten calls a game", async () => {
    await insertGame(db, makeGame({ ...FREE_A, status: "finished", ply: 4 }));
    expect(await one(FREE_A)).toMatchObject({ left: 100 });
  });

  it("stays closed for an hour after its provider said too many requests", async () => {
    await pausePool(db, { id: "openrouter", kind: "requests" }, NOON - 59 * 60_000);
    expect(await one(FREE_A)).toMatchObject({ left: 0, closed: "rate_limited" });
    await pausePool(db, { id: "openrouter", kind: "requests" }, NOON - 60 * 60_000);
    expect(await one(FREE_A)).toMatchObject({ closed: null });
  });
});

describe("a paid model's budget", () => {
  it("is ten cents a day, at the model's price for the tokens a game takes", async () => {
    // 40 calls of 1,500 tokens at 4.2 cents a million is a quarter of a cent a game.
    expect(await one(JEV)).toEqual({
      pool: { id: "jev/jev-latest", kind: "cents" }, left: 39, closed: null, used: 0, limit: 10,
      resetsAt: nextResetAt(NOON), readAt: null, error: null,
    });
    expect(await one(LUNA)).toMatchObject({ left: 16 });
  });

  it("takes off what today's tokens cost", async () => {
    await used(JEV, 800, 1_200_000);
    const budget = await one(JEV);
    expect(budget.used).toBeCloseTo(5.04);
    expect(budget).toMatchObject({ left: 19, closed: null });
  });

  it("uses the tokens a call has taken lately, once there are calls to go by", async () => {
    await used(JEV, 100, 300_000, "2026-10-08");
    // 3,000 tokens a call makes a game twice the price, so half as many games.
    expect(await one(JEV)).toMatchObject({ used: 0, left: 19 });
  });

  it("closes when the day's ten cents are spent", async () => {
    await used(LUNA, 700, 1_000_000);
    expect(await one(LUNA)).toMatchObject({ left: 0, closed: "daily_budget", used: 10 });
  });

  it("keeps each paid model's ten cents apart", async () => {
    await used(LUNA, 700, 1_000_000);
    expect(await one(JEV)).toMatchObject({ used: 0, left: 39 });
  });
});

describe("supplies", () => {
  it("has no budget for the scripted opponent", async () => {
    expect(await supplies(db, source(), [{ provider: "fake", model: "fake-1" }, JEV], NOON)).toMatchObject([null, { left: 39 }]);
  });
});
