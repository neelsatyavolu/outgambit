import { describe, expect, it } from "vitest";
import { expectedPlayers, playerShare } from "./share";

describe("expectedPlayers", () => {
  it("expects the usual crowd at the start of the day", () => {
    expect(expectedPlayers({ activeToday: 0, dailyAverage: 6, dayFractionLeft: 1 })).toBe(6);
  });

  it("adds those still expected to those who have played", () => {
    expect(expectedPlayers({ activeToday: 3, dailyAverage: 6, dayFractionLeft: 0.5 })).toBe(6);
  });

  it("counts only those who came once the day is over", () => {
    expect(expectedPlayers({ activeToday: 2, dailyAverage: 6, dayFractionLeft: 0 })).toBe(2);
  });

  it("grows past the usual crowd on a busy day", () => {
    expect(expectedPlayers({ activeToday: 9, dailyAverage: 6, dayFractionLeft: 0.5 })).toBe(12);
  });

  it("is never less than one", () => {
    expect(expectedPlayers({ activeToday: 0, dailyAverage: 0, dayFractionLeft: 1 })).toBe(1);
  });
});

describe("playerShare", () => {
  it("splits the day's games evenly, rounding down", () => {
    expect(playerShare(20, 6)).toBe(3);
  });

  it("gives one player everything", () => {
    expect(playerShare(20, 1)).toBe(20);
  });

  it("is one game when there are fewer games than players", () => {
    expect(playerShare(2, 6)).toBe(1);
  });
});
