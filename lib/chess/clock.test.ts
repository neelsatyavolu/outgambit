import { describe, expect, it } from "vitest";
import { chargeMove, remainingMs } from "./clock";

const game = { whiteMs: 60_000, blackMs: 50_000, turnStartedAt: 1_000, ply: 0, status: "active" as const };

describe("remainingMs", () => {
  it("runs the clock of the side to move", () => {
    expect(remainingMs(game, "white", 11_000)).toBe(50_000);
  });

  it("leaves the waiting side's clock alone", () => {
    expect(remainingMs(game, "black", 11_000)).toBe(50_000);
    expect(remainingMs({ ...game, ply: 1 }, "white", 11_000)).toBe(60_000);
  });

  it("goes negative once the time is used up", () => {
    expect(remainingMs(game, "white", 62_000)).toBe(-1_000);
  });

  it("stops both clocks when the game is over", () => {
    expect(remainingMs({ ...game, status: "finished" }, "white", 99_000)).toBe(60_000);
  });
});

describe("chargeMove", () => {
  it("subtracts the time spent and adds the increment", () => {
    expect(chargeMove(60_000, 1_000, 6_000, 2_000)).toEqual({ flagged: false, nextMs: 57_000, spentMs: 5_000 });
  });

  it("adds nothing without an increment", () => {
    expect(chargeMove(60_000, 1_000, 6_000, 0).nextMs).toBe(55_000);
  });

  it("flags when the time ran out, and grants no increment", () => {
    expect(chargeMove(4_000, 1_000, 6_000, 2_000)).toEqual({ flagged: true, nextMs: 0, spentMs: 5_000 });
  });

  it("flags when exactly no time is left", () => {
    expect(chargeMove(5_000, 1_000, 6_000, 0).flagged).toBe(true);
  });

  it("never charges negative time if clocks disagree", () => {
    expect(chargeMove(60_000, 6_000, 1_000, 0)).toEqual({ flagged: false, nextMs: 60_000, spentMs: 0 });
  });
});
