import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { applyMove, outcomeOf, replay } from "./rules";

const FOOLS_MATE = ["f3", "e5", "g4", "Qh4#"];
// Sam Loyd's ten-move stalemate.
const STALEMATE = [
  "e3", "a5", "Qh5", "Ra6", "Qxa5", "h5", "h4", "Rah6", "Qxc7", "f6",
  "Qxd7+", "Kf7", "Qxb7", "Qd3", "Qxb8", "Qh7", "Qxc8", "Kg6", "Qe6",
];
const SHUFFLE = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];

describe("replay", () => {
  it("starts with white to move and twenty legal moves", () => {
    const position = replay([]);
    expect(position.turn).toBe("white");
    expect(position.legal).toHaveLength(20);
    expect(position.outcome).toBeNull();
  });

  it("describes each legal move in SAN and UCI", () => {
    const knight = replay([]).legal.find((m) => m.san === "Nf3");
    expect(knight).toMatchObject({ uci: "g1f3", from: "g1", to: "f3", piece: "n", check: false, mate: false });
  });

  it("reports checkmate for the side that delivered it", () => {
    expect(replay(FOOLS_MATE).outcome).toEqual({ result: "black", reason: "checkmate" });
  });

  it("reports stalemate as a draw", () => {
    expect(replay(STALEMATE).outcome).toEqual({ result: "draw", reason: "stalemate" });
  });

  it("reports threefold repetition as a draw", () => {
    expect(replay(SHUFFLE).outcome).toEqual({ result: "draw", reason: "repetition" });
  });

  it("throws on a corrupt history", () => {
    expect(() => replay(["e4", "e4"])).toThrow();
  });
});

describe("outcomeOf", () => {
  it("reports the fifty-move rule", () => {
    expect(outcomeOf(new Chess("8/8/8/8/8/5k2/8/4K2R w - - 100 80"))).toEqual({ result: "draw", reason: "fifty_move" });
  });

  it("reports insufficient material", () => {
    expect(outcomeOf(new Chess("8/8/8/8/8/5k2/8/4K3 w - - 0 1"))).toEqual({
      result: "draw",
      reason: "insufficient_material",
    });
  });
});

describe("applyMove", () => {
  it("applies a UCI move", () => {
    expect(applyMove([], "e2e4")).toMatchObject({ san: "e4", uci: "e2e4", outcome: null });
  });

  it("applies a SAN move", () => {
    expect(applyMove(["e4"], "e5")?.uci).toBe("e7e5");
  });

  it("returns the position after the move", () => {
    expect(applyMove([], "e2e4")?.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  });

  it("reports the outcome when the move ends the game", () => {
    expect(applyMove(FOOLS_MATE.slice(0, 3), "d8h4")?.outcome).toEqual({ result: "black", reason: "checkmate" });
  });

  it("returns null for an illegal move", () => {
    expect(applyMove([], "e2e5")).toBeNull();
  });

  it("returns null for nonsense", () => {
    expect(applyMove([], "castle please")).toBeNull();
  });

  it("requires a promotion piece in UCI", () => {
    const history = ["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6"];
    expect(applyMove(history, "b7a8")).toBeNull();
    expect(applyMove(history, "b7a8q")?.san).toBe("bxa8=Q");
  });
});
