import { describe, expect, it } from "vitest";
import { summarise, winRate, type GameTally } from "./stats";

const tally = (overrides: Partial<GameTally>): GameTally => ({
  modelLabel: "Fake",
  timeControl: "5+0",
  playerColor: "white",
  played: 1,
  won: 0,
  drawn: 0,
  ...overrides,
});

describe("summarise", () => {
  it("reports an empty record for a player with no finished games", () => {
    expect(summarise([])).toEqual({
      overall: { played: 0, won: 0, lost: 0, drawn: 0 },
      byModel: [],
      byTimeControl: [],
      byColor: [],
    });
  });

  it("adds every group into the overall record", () => {
    const stats = summarise([tally({ played: 3, won: 2, drawn: 1 }), tally({ playerColor: "black", played: 2, won: 0 })]);
    expect(stats.overall).toEqual({ played: 5, won: 2, lost: 2, drawn: 1 });
  });

  it("splits the record by model, most played first", () => {
    const stats = summarise([
      tally({ modelLabel: "Alpha", played: 1, won: 1 }),
      tally({ modelLabel: "Beta", timeControl: "5+0", played: 2, won: 1 }),
      tally({ modelLabel: "Beta", timeControl: "10+10", played: 2, drawn: 1 }),
    ]);
    expect(stats.byModel).toEqual([
      { name: "Beta", played: 4, won: 1, lost: 2, drawn: 1 },
      { name: "Alpha", played: 1, won: 1, lost: 0, drawn: 0 },
    ]);
  });

  it("splits the record by time control and by colour", () => {
    const stats = summarise([
      tally({ timeControl: "5+0", playerColor: "black", played: 1, won: 1 }),
      tally({ timeControl: "10+10", playerColor: "white", played: 3, won: 1 }),
    ]);
    expect(stats.byTimeControl.map((line) => line.name)).toEqual(["10+10", "5+0"]);
    expect(stats.byColor).toEqual([
      { name: "white", played: 3, won: 1, lost: 2, drawn: 0 },
      { name: "black", played: 1, won: 1, lost: 0, drawn: 0 },
    ]);
  });
});

describe("winRate", () => {
  it("is the share of games won, as a whole percentage", () => {
    expect(winRate({ played: 3, won: 1, lost: 2, drawn: 0 })).toBe(33);
    expect(winRate({ played: 2, won: 2, lost: 0, drawn: 0 })).toBe(100);
  });

  it("is null before any game has been played", () => {
    expect(winRate({ played: 0, won: 0, lost: 0, drawn: 0 })).toBeNull();
  });
});
