import { describe, expect, it } from "vitest";
import { LEVELS, expectedScore, matchElo, poolOf, rate, startingRatings } from "./elo";

describe("poolOf", () => {
  it("puts the quick time controls in the bullet pool and the rest in regular", () => {
    expect(["1+0", "2+1", "3+0", "5+0"].map(poolOf)).toEqual(["bullet", "bullet", "bullet", "bullet"]);
    expect(["10+10", "20+20", "45+30"].map(poolOf)).toEqual(["regular", "regular", "regular"]);
  });
});

describe("startingRatings", () => {
  it("offers the levels from new to expert, each stronger than the last", () => {
    expect(LEVELS.map((l) => l.id)).toEqual([
      "new", "beginner", "beginner-intermediate", "intermediate", "intermediate-advanced", "advanced", "expert",
    ]);
    const ratings = LEVELS.map((l) => l.rating);
    expect([...ratings].sort((a, b) => a - b)).toEqual(ratings);
  });

  it("turns a level into a rating for each pool, with bullet a little lower", () => {
    expect(startingRatings({ kind: "level", level: "intermediate" })).toEqual({ regular: 1300, bullet: 1200 });
    expect(startingRatings({ kind: "level", level: "new" })).toEqual({ regular: 400, bullet: 300 });
  });

  it("uses chess.com ratings as given", () => {
    expect(startingRatings({ kind: "chesscom", bullet: 1432, regular: 1688 })).toEqual({ regular: 1688, bullet: 1432 });
  });
});

describe("expectedScore", () => {
  it("is even between equals and favours the higher rating", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
    expect(expectedScore(1900, 1500)).toBeCloseTo(0.909, 3);
    expect(expectedScore(1500, 1900)).toBeCloseTo(0.091, 3);
  });
});

describe("matchElo", () => {
  it("is level at an even score, and about 191 ahead at three points in four", () => {
    expect(matchElo(50, 100)).toEqual({ diff: 0, margin: 68, bound: false });
    expect(matchElo(75, 100)).toEqual({ diff: 191, margin: 79, bound: false });
    expect(matchElo(25, 100)).toEqual({ diff: -191, margin: 79, bound: false });
  });

  it("gives a bound when one side took every game", () => {
    expect(matchElo(20, 20)).toEqual({ diff: 301, margin: 0, bound: true });
    expect(matchElo(0, 20)).toEqual({ diff: -301, margin: 0, bound: true });
  });

  it("is nothing when no games were played", () => {
    expect(matchElo(0, 0)).toEqual({ diff: 0, margin: 0, bound: false });
  });
});

describe("rate", () => {
  const settled = { playerGames: 30, modelGames: 30 };

  it("moves both sides in opposite directions after a win", () => {
    const next = rate({ player: 1500, model: 1500, score: 1, ...settled });
    expect(next).toEqual({ player: 1512, model: 1492 });
  });

  it("barely moves anyone when the favourite wins", () => {
    const next = rate({ player: 1900, model: 1300, score: 1, ...settled });
    expect(next.player - 1900).toBeLessThanOrEqual(1);
    expect(1300 - next.model).toBeLessThanOrEqual(1);
  });

  it("moves a lot when the underdog wins", () => {
    const next = rate({ player: 1300, model: 1900, score: 1, ...settled });
    expect(next.player - 1300).toBeGreaterThan(20);
  });

  it("treats a draw as half a win", () => {
    expect(rate({ player: 1500, model: 1500, score: 0.5, ...settled })).toEqual({ player: 1500, model: 1500 });
    expect(rate({ player: 1300, model: 1700, score: 0.5, ...settled }).player).toBeGreaterThan(1300);
  });

  it("moves a new player faster, since their starting rating is a guess", () => {
    const fresh = rate({ player: 1500, model: 1500, score: 0, playerGames: 0, modelGames: 30 });
    const veteran = rate({ player: 1500, model: 1500, score: 0, playerGames: 30, modelGames: 30 });
    expect(1500 - fresh.player).toBeGreaterThan(1500 - veteran.player);
  });

  it("moves a model less when its opponent's rating is still a guess", () => {
    const vsFresh = rate({ player: 1500, model: 1500, score: 1, playerGames: 0, modelGames: 30 });
    const vsVeteran = rate({ player: 1500, model: 1500, score: 1, playerGames: 30, modelGames: 30 });
    expect(1500 - vsFresh.model).toBeLessThan(1500 - vsVeteran.model);
  });

  it("never drops a rating below 100", () => {
    expect(rate({ player: 105, model: 100, score: 0, playerGames: 0, modelGames: 0 }).player).toBe(100);
  });
});
