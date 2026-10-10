import { describe, expect, it } from "vitest";
import type { OfferedModel } from "../owner/catalog";
import type { RatedModel } from "./board";
import { opponentGroups, ratingFor } from "./opponents";

const FAST = ["1+0", "5+0", "10+10", "20+20"];
const SLOW = ["10+10", "20+20", "45+30"];

const model = (id: string, timeControls: string[], supportsEffort = false): OfferedModel =>
  ({ provider: "openrouter", id, label: id, supportsEffort, timeControls }) as OfferedModel;

const line = (id: string, pool: RatedModel["pool"], rating: number, effort: RatedModel["effort"] = null): RatedModel => ({
  provider: "openrouter",
  id,
  label: id,
  effort,
  pool,
  rating,
  games: 0,
});

describe("ratingFor", () => {
  const ratings = [line("quick", "bullet", 900), line("quick", "regular", 1000), line("slow", "regular", 1200)];

  it("finds the line for the pool, falling back to regular for a model that does not play it", () => {
    expect(ratingFor(ratings, model("quick", FAST), "medium", "bullet")?.rating).toBe(900);
    expect(ratingFor(ratings, model("slow", SLOW), "medium", "bullet")?.rating).toBe(1200);
    expect(ratingFor(ratings, model("unknown", SLOW), "medium", "regular")).toBeUndefined();
  });

  it("uses the chosen effort only for models that have one", () => {
    const withEffort = [line("thinker", "regular", 1100, "low"), line("thinker", "regular", 1300, "high")];
    expect(ratingFor(withEffort, model("thinker", SLOW, true), "high", "regular")?.rating).toBe(1300);
    expect(ratingFor(withEffort, model("thinker", SLOW, true), "low", "regular")?.rating).toBe(1100);
  });
});

describe("opponentGroups", () => {
  const models = [model("slow-weak", SLOW), model("quick-weak", FAST), model("slow-strong", SLOW), model("quick-strong", FAST)];
  const ratings = [
    line("slow-weak", "regular", 1000),
    line("slow-strong", "regular", 1400),
    line("quick-weak", "bullet", 800),
    line("quick-weak", "regular", 1900),
    line("quick-strong", "bullet", 950),
    line("quick-strong", "regular", 900),
  ];

  it("puts bullet players first, then the rest, each strongest first by that pool's rating", () => {
    const groups = opponentGroups(models, ratings, "medium");
    expect(groups.map((g) => g.pool)).toEqual(["bullet", "regular"]);
    expect(groups[0].opponents.map((o) => o.model.id)).toEqual(["quick-strong", "quick-weak"]);
    expect(groups[0].opponents.map((o) => o.line?.rating)).toEqual([950, 800]);
    expect(groups[1].opponents.map((o) => o.model.id)).toEqual(["slow-strong", "slow-weak"]);
  });

  it("lists every model exactly once", () => {
    const listed = opponentGroups(models, ratings, "medium").flatMap((g) => g.opponents.map((o) => o.model.id));
    expect([...listed].sort()).toEqual(models.map((m) => m.id).sort());
  });

  it("leaves out a group with nobody in it", () => {
    expect(opponentGroups([model("slow-weak", SLOW)], ratings, "medium").map((g) => g.pool)).toEqual(["regular"]);
    expect(opponentGroups([], ratings, "medium")).toEqual([]);
  });

  it("orders by the rating at the chosen effort", () => {
    const thinkers = [model("a", SLOW, true), model("b", SLOW, true)];
    const byEffort = [
      line("a", "regular", 1500, "low"),
      line("a", "regular", 1000, "high"),
      line("b", "regular", 1200, "low"),
      line("b", "regular", 1300, "high"),
    ];
    expect(opponentGroups(thinkers, byEffort, "low")[0].opponents.map((o) => o.model.id)).toEqual(["a", "b"]);
    expect(opponentGroups(thinkers, byEffort, "high")[0].opponents.map((o) => o.model.id)).toEqual(["b", "a"]);
  });

  it("keeps a model with no rating line, after the rated ones", () => {
    const groups = opponentGroups([model("unrated", SLOW), model("slow-weak", SLOW)], ratings, "medium");
    expect(groups[0].opponents.map((o) => o.model.id)).toEqual(["slow-weak", "unrated"]);
  });
});
