import { describe, expect, it } from "vitest";
import { assessMoves, shortlist } from "./tactics";

const sans = (history: string[]) => shortlist(assessMoves(history)).map((a) => a.move.san);
const find = (history: string[], san: string) => assessMoves(history).find((a) => a.move.san === san)!;

describe("assessMoves", () => {
  it("assesses every legal move", () => {
    expect(assessMoves([])).toHaveLength(20);
  });

  it("recognises checkmate in one", () => {
    expect(find(["f3", "e5", "g4"], "Qh4#")).toMatchObject({ mate: true });
  });

  it("recognises a move that lets the opponent mate next move", () => {
    expect(find(["f3", "e5"], "g4")).toMatchObject({ allowsMate: true });
    expect(find(["f3", "e5"], "e4")).toMatchObject({ allowsMate: false });
  });

  it("counts what a capture wins", () => {
    // 1. e4 e5 2. Nf3 Qh4 leaves the queen where the knight can take it.
    expect(find(["e4", "e5", "Nf3", "Qh4"], "Nxh4")).toMatchObject({ gain: 9, loss: 0, score: 9 });
  });

  it("counts a piece left where it can be taken for less", () => {
    // After 1. e4 e5, Ba6 puts the bishop where a pawn takes it.
    expect(find(["e4", "e5"], "Ba6")).toMatchObject({ gain: 0, loss: 3, score: -3 });
  });

  it("counts a threatened piece that the move does nothing about", () => {
    // 1. e4 d5 2. exd5 Qxd5 3. Nc3 attacks the queen.
    const history = ["e4", "d5", "exd5", "Qxd5", "Nc3"];
    expect(find(history, "Nf6").loss).toBe(9);
    expect(find(history, "Qa5").loss).toBe(0);
  });

  it("does not count a piece that is defended against an equal attacker", () => {
    // 1. e4 e5 2. Nf3 Nc6: the e5 pawn is attacked by the knight and defended by the knight.
    expect(find(["e4", "e5", "Nf3", "Nc6"], "Bc4").loss).toBe(0);
  });

  it("values a promotion", () => {
    const history = ["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6"];
    expect(find(history, "bxa8=Q").gain).toBe(5 + 8);
  });
});

describe("shortlist", () => {
  it("is only the mate when there is one", () => {
    expect(sans(["f3", "e5", "g4"])).toEqual(["Qh4#"]);
  });

  it("drops moves that allow mate in one", () => {
    expect(sans(["f3", "e5"])).not.toContain("g4");
  });

  it("is only the capture when a queen is free", () => {
    expect(sans(["e4", "e5", "Nf3", "Qh4"])).toEqual(["Nxh4"]);
  });

  it("keeps only moves that save a threatened queen", () => {
    const moves = sans(["e4", "d5", "exd5", "Qxd5", "Nc3"]);
    expect(moves).toContain("Qa5");
    expect(moves).not.toContain("Nf6");
    expect(moves.every((san) => san.startsWith("Q"))).toBe(true);
  });

  it("leaves a quiet position wide open", () => {
    expect(sans([]).length).toBe(20);
  });

  it("keeps every move when all of them allow mate", () => {
    // Black to move, about to be mated on the back rank whatever happens.
    const all = assessMoves([]).map((a) => ({ ...a, allowsMate: true }));
    expect(shortlist(all)).toHaveLength(20);
  });
});
