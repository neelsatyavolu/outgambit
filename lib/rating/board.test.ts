import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { applyModelRating, ensureModelRating } from "../db/ratings";
import type { OfferedModel } from "../owner/catalog";
import { modelBoard } from "./board";

const JEV: OfferedModel = { provider: "jev", id: "jev-latest", label: "Jev", supportsEffort: false, timeControls: ["1+0", "3+0", "10+10"] };
const ASTRA: OfferedModel = { provider: "codex", id: "gpt-6-astra", label: "GPT-6 Astra", supportsEffort: true, timeControls: ["10+10", "20+20"] };

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

describe("modelBoard", () => {
  it("lists a fast model in both pools at its estimated rating", async () => {
    expect(await modelBoard(db, [JEV])).toEqual([
      { provider: "jev", id: "jev-latest", label: "Jev", effort: null, pool: "bullet", rating: 950, games: 0 },
      { provider: "jev", id: "jev-latest", label: "Jev", effort: null, pool: "regular", rating: 850, games: 0 },
    ]);
  });

  it("lists a slow model once per effort, in the regular pool only", async () => {
    const board = await modelBoard(db, [ASTRA]);
    expect(board.map((r) => [r.effort, r.pool, r.rating])).toEqual([
      ["high", "regular", 1220],
      ["medium", "regular", 1100],
      ["low", "regular", 980],
    ]);
  });

  it("uses a model's earned rating once it has played", async () => {
    await ensureModelRating(db, "jev/jev-latest", "bullet", 950);
    await applyModelRating(db, "jev/jev-latest", "bullet", 1012);
    const bullet = (await modelBoard(db, [JEV])).find((r) => r.pool === "bullet");
    expect(bullet).toMatchObject({ rating: 1012, games: 1 });
  });

  it("orders each pool from strongest to weakest", async () => {
    const regular = (await modelBoard(db, [JEV, ASTRA])).filter((r) => r.pool === "regular").map((r) => r.rating);
    expect(regular).toEqual([...regular].sort((a, b) => b - a));
  });
});
