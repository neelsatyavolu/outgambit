import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { makeGame, NOON } from "@/test/factory";
import { accountPlayerId } from "../account/session";
import type { Db } from "../db/client";
import { getGame, insertGame } from "../db/games";
import { listModelRatings } from "../db/ratings";
import { getUser, insertUser, setSkill } from "../db/users";
import type { Game } from "../game/types";
import { settleRatings } from "./settle";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

/** An account rated 1300 regular and 1200 bullet. */
async function player(): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, email: `${id}@example.com`, passwordHash: "x", createdAt: NOON });
  await setSkill(db, id, { level: "intermediate", ratings: { regular: 1300, bullet: 1200 } });
  return id;
}

// A finished game against Jev (seeded at 850 regular, 950 bullet).
const finished = (userId: string, overrides: Partial<Game> = {}): Game =>
  makeGame({
    playerId: accountPlayerId(userId), provider: "jev", model: "jev-latest", modelLabel: "Jev", effort: null,
    status: "finished", result: "white", reason: "checkmate", playerColor: "white", ...overrides,
  });

const modelRating = async (key: string, pool: string) =>
  (await listModelRatings(db)).find((r) => r.key === key && r.pool === pool);

describe("settleRatings", () => {
  it("raises the winner and lowers the loser, in the pool the game was played in", async () => {
    const id = await player();
    const game = finished(id);
    await insertGame(db, game);
    expect(await settleRatings(db)).toBe(1);

    const user = await getUser(db, id);
    expect(user!.ratings.regular).toBeGreaterThan(1300);
    expect(user!.ratings.bullet).toBe(1200);
    expect(user!.games).toEqual({ regular: 1, bullet: 0 });
    const jev = await modelRating("jev/jev-latest", "regular");
    expect(jev!.rating).toBeLessThan(850);
    expect(jev!.games).toBe(1);
  });

  it("records the ratings before and after on the game", async () => {
    const id = await player();
    const game = finished(id);
    await insertGame(db, game);
    await settleRatings(db);
    const saved = await getGame(db, game.id);
    expect(saved!.rated).toBe(true);
    expect(saved!.rating).toMatchObject({ playerBefore: 1300, aiBefore: 850 });
    expect(saved!.rating!.playerAfter).toBe((await getUser(db, id))!.ratings.regular);
    expect(saved!.rating!.aiAfter).toBe((await modelRating("jev/jev-latest", "regular"))!.rating);
  });

  it("counts a quick game toward bullet ratings only", async () => {
    const id = await player();
    await insertGame(db, finished(id, { timeControl: "3+0", result: "black" }));
    await settleRatings(db);
    const user = await getUser(db, id);
    expect(user!.ratings.regular).toBe(1300);
    expect(user!.ratings.bullet).toBeLessThan(1200);
    expect((await modelRating("jev/jev-latest", "bullet"))!.rating).toBeGreaterThan(950);
    expect(await modelRating("jev/jev-latest", "regular")).toBeUndefined();
  });

  it("rates a model separately at each effort, starting from its estimate", async () => {
    const id = await player();
    const astra = { provider: "codex", model: "gpt-6-astra", modelLabel: "GPT-6 Astra" } as const;
    await insertGame(db, finished(id, { ...astra, effort: "high", result: "draw" }));
    await insertGame(db, finished(id, { ...astra, effort: "low", result: "draw", createdAt: NOON + 1 }));
    await settleRatings(db);
    const keys = (await listModelRatings(db)).map((r) => r.key).sort();
    expect(keys).toEqual(["codex/gpt-6-astra#high", "codex/gpt-6-astra#low"]);
  });

  it("gives a draw to neither side when they are equal, and to the underdog otherwise", async () => {
    const id = await player();
    await insertGame(db, finished(id, { result: "draw", reason: "stalemate" }));
    await settleRatings(db);
    // The player (1300) was the favourite against Jev (850), so a draw costs them.
    expect((await getUser(db, id))!.ratings.regular).toBeLessThan(1300);
  });

  it("rates each game once, however often and however concurrently it is asked", async () => {
    const id = await player();
    await insertGame(db, finished(id));
    await Promise.all([settleRatings(db), settleRatings(db), settleRatings(db)]);
    const after = (await getUser(db, id))!.ratings.regular;
    expect(await settleRatings(db)).toBe(0);
    expect((await getUser(db, id))!.ratings.regular).toBe(after);
    expect((await getUser(db, id))!.games.regular).toBe(1);
    expect((await modelRating("jev/jev-latest", "regular"))!.games).toBe(1);
  });

  it("leaves games that are still going, or were aborted, unrated", async () => {
    const id = await player();
    const live = finished(id, { status: "active", result: null, reason: null });
    const aborted = finished(id, { status: "aborted", result: null, reason: "provider_error" });
    await insertGame(db, live);
    await insertGame(db, aborted);
    expect(await settleRatings(db)).toBe(0);
    expect((await getGame(db, live.id))!.rated).toBe(false);
    expect((await getUser(db, id))!.games).toEqual({ regular: 0, bullet: 0 });
  });

  it("closes out a guest's old game without rating anyone", async () => {
    const game = makeGame({ playerId: randomUUID(), status: "finished", result: "white", reason: "checkmate" });
    await insertGame(db, game);
    await settleRatings(db);
    const saved = await getGame(db, game.id);
    expect(saved).toMatchObject({ rated: true, rating: null });
    expect(await listModelRatings(db)).toEqual([]);
  });

  it("does not rate a game played before the player had a starting rating", async () => {
    const id = randomUUID();
    await insertUser(db, { id, email: `${id}@example.com`, passwordHash: "x", createdAt: NOON });
    const game = finished(id);
    await insertGame(db, game);
    expect(await settleRatings(db)).toBe(0);
    expect(await getGame(db, game.id)).toMatchObject({ rated: true, rating: null });
    // Their rating is still unset, so they can still choose where it starts.
    expect((await getUser(db, id))!.ratings).toEqual({ bullet: null, regular: null });
    expect(await setSkill(db, id, { level: "beginner", ratings: { regular: 700, bullet: 600 } })).toBe(true);
  });

  it("settles games in the order they were played", async () => {
    const id = await player();
    const first = finished(id, { createdAt: NOON });
    const second = finished(id, { createdAt: NOON + 60_000 });
    await insertGame(db, second);
    await insertGame(db, first);
    await settleRatings(db);
    expect((await getGame(db, second.id))!.rating!.playerBefore).toBe((await getGame(db, first.id))!.rating!.playerAfter);
  });
});

describe("arena games", () => {
  // Jev (850 regular) with white against Liquid d1 (800 regular).
  const arena = (overrides: Partial<Game> = {}): Game =>
    makeGame({
      playerId: "arena", provider: "gateway", model: "liquid/d1", modelLabel: "Liquid d1", effort: null,
      rival: { provider: "jev", model: "jev-latest", modelLabel: "Jev", effort: null },
      status: "finished", result: "white", reason: "checkmate", playerColor: "white", ...overrides,
    });

  it("moves both models by the result, with no player involved", async () => {
    const game = arena();
    await insertGame(db, game);
    expect(await settleRatings(db)).toBe(1);
    const jev = (await modelRating("jev/jev-latest", "regular"))!;
    const liquid = (await modelRating("gateway/liquid/d1", "regular"))!;
    expect([jev.rating, jev.games]).toEqual([857, 1]);
    expect([liquid.rating, liquid.games]).toEqual([793, 1]);
    expect(await getGame(db, game.id)).toMatchObject({
      rated: true, rating: { playerBefore: 850, playerAfter: 857, aiBefore: 800, aiAfter: 793 },
    });
  });

  it("credits black when black wins, and rates a draw toward the lower-rated model", async () => {
    await insertGame(db, arena({ result: "black" }));
    await settleRatings(db);
    expect((await modelRating("jev/jev-latest", "regular"))!.rating).toBeLessThan(850);
    expect((await modelRating("gateway/liquid/d1", "regular"))!.rating).toBeGreaterThan(800);
    await resetDb(db);
    await insertGame(db, arena({ result: "draw", reason: "repetition" }));
    await settleRatings(db);
    expect((await modelRating("jev/jev-latest", "regular"))!.rating).toBe(849);
    expect((await modelRating("gateway/liquid/d1", "regular"))!.rating).toBe(801);
  });

  it("rates in the pool the game was played in, at each model's own effort", async () => {
    const rival = { provider: "codex", model: "gpt-6-astra", modelLabel: "GPT-6 Astra", effort: "medium" } as const;
    await insertGame(db, arena({ rival }));
    await insertGame(db, arena({ timeControl: "3+0", createdAt: NOON + 1 }));
    await settleRatings(db);
    expect((await listModelRatings(db)).map((r) => [r.key, r.pool, r.games])).toEqual([
      ["codex/gpt-6-astra#medium", "regular", 1],
      ["gateway/liquid/d1", "bullet", 1],
      ["gateway/liquid/d1", "regular", 1],
      ["jev/jev-latest", "bullet", 1],
    ]);
  });

  it("does not rate an arena game that was called off", async () => {
    await insertGame(db, arena({ status: "aborted", result: null, reason: "provider_error" }));
    expect(await settleRatings(db)).toBe(0);
    expect(await listModelRatings(db)).toEqual([]);
  });
});

describe("setSkill", () => {
  it("cannot be changed once the player has a rated game", async () => {
    const id = await player();
    await insertGame(db, finished(id));
    await settleRatings(db);
    expect(await setSkill(db, id, { level: "expert", ratings: { regular: 2200, bullet: 2100 } })).toBe(false);
    expect((await getUser(db, id))!.level).toBe("intermediate");
  });

  it("can be corrected before any game is rated", async () => {
    const id = await player();
    expect(await setSkill(db, id, { level: null, ratings: { regular: 1650, bullet: 1500 } })).toBe(true);
    expect(await getUser(db, id)).toMatchObject({ level: null, ratings: { regular: 1650, bullet: 1500 } });
  });
});
