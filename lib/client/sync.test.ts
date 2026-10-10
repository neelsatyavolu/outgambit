import { describe, expect, it } from "vitest";
import type { GameView } from "../game/types";
import { isStale, shownFen } from "./sync";

const view = (moves: number, status: GameView["status"] = "active"): GameView =>
  ({
    status,
    fen: `fen-${moves}`,
    moves: Array.from({ length: moves }, (_, ply) => ({ ply, san: "x", uci: "a1a2", fenAfter: `fen-${ply + 1}`, spentMs: 0 })),
  }) as GameView;

describe("isStale", () => {
  it("accepts the first view and any view with as many or more moves", () => {
    expect(isStale(null, view(0))).toBe(false);
    expect(isStale(view(2), view(2))).toBe(false);
    expect(isStale(view(2), view(3))).toBe(false);
  });

  it("rejects a view from before a move that is already on the board", () => {
    expect(isStale(view(3), view(2))).toBe(true);
  });

  it("rejects a view that would bring a finished game back to life", () => {
    expect(isStale(view(4, "finished"), view(4, "active"))).toBe(true);
    expect(isStale(view(4, "active"), view(4, "finished"))).toBe(false);
  });
});

describe("shownFen", () => {
  const START = "start";

  it("shows the live position when no earlier move is selected", () => {
    expect(shownFen(view(3), null, START)).toBe("fen-3");
  });

  it("shows the position after the selected move, or the start", () => {
    expect(shownFen(view(3), 2, START)).toBe("fen-2");
    expect(shownFen(view(3), 0, START)).toBe(START);
  });

  it("falls back to the live position when the selection is out of range", () => {
    expect(shownFen(view(1), 5, START)).toBe("fen-1");
  });
});
