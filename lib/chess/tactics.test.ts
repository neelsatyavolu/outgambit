import { describe, expect, it } from "vitest";
import { assessFen, assessMoves, shortlist } from "./tactics";

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
    // The knight on f6 can recapture on d5: a queen for a knight still loses six.
    expect(find(history, "Nf6").loss).toBe(6);
    expect(find(history, "Qa5").loss).toBe(0);
  });

  it("does not count a king as winning a piece its own side defends", () => {
    // Qd7 is next to the black king and defended by the white king, so the king cannot take it.
    const played = assessFen("4k3/8/4K3/8/8/8/8/3Q4 w - - 0 1").find((a) => a.move.san === "Qd7+");
    expect(played).toMatchObject({ loss: 0, score: 0 });
    // The same queen with the white king far away is taken.
    expect(assessFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1").find((a) => a.move.san === "Qd7+")?.loss).toBe(9);
  });

  it("does not count a piece that is defended against an equal attacker", () => {
    // 1. e4 e5 2. Nf3 Nc6: the e5 pawn is attacked by the knight and defended by the knight.
    expect(find(["e4", "e5", "Nf3", "Nc6"], "Bc4").loss).toBe(0);
  });

  it("values a promotion", () => {
    const history = ["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6"];
    expect(find(history, "bxa8=Q").gain).toBe(5 + 8);
  });

  it.each([
    ["an attacker pinned to its king", "4k3/4n3/8/3B4/8/8/P7/K3R3 w - - 0 1", 0],
    ["a defender pinned to its king", "4r2k/6b1/8/8/3B4/8/P3N3/4K3 w - - 0 1", 3],
    ["a rook exchanged for a knight", "7k/8/2n5/8/3R4/8/P4B2/6K1 w - - 0 1", 2],
    ["an x-ray recapture after an even trade", "3r3k/6b1/8/8/3B4/4P3/P7/6K1 w - - 0 1", 1],
  ])("counts the legal exchange with %s", (_name, fen, loss) => {
    expect(assessFen(fen).find((a) => a.move.san === "a3")).toMatchObject({ loss, score: 0 - loss });
  });

  it("counts a pawn lost to en passant", () => {
    expect(assessFen("k7/8/8/8/3p4/8/4P3/6K1 w - - 0 1").find((a) => a.move.san === "e4"))
      .toMatchObject({ loss: 1, score: -1 });
  });

  it("avoids a checking fork that wins the queen on the following move", () => {
    const assessed = assessFen("6k1/8/8/8/3n4/8/7P/Q3K3 w - - 0 1");
    // h3 Nc2+ forces a king move, then Nxa1 wins the queen.
    expect(assessed.find((a) => a.move.san === "h3")?.loss).toBe(9);
    expect(shortlist(assessed).map((a) => a.move.san)).not.toContain("h3");
  });

  it("keeps a move when the checking fork can be captured", () => {
    // After h3 Nc2+, Bxc2 saves the queen and wins the knight.
    expect(assessFen("6k1/8/8/8/3n4/8/7P/QB2K3 w - - 0 1").find((a) => a.move.san === "h3")?.loss).toBe(0);
  });

  it("does not treat a promotion ending in stalemate as a material threat", () => {
    expect(assessFen("8/5k1K/8/5b2/8/8/6p1/8 w - - 0 1").find((a) => a.move.san === "Kh8")?.loss).toBe(0);
  });

  it("uses a stronger recapture when the cheapest one exposes an x-ray", () => {
    // After bxa4, Rxa4 keeps b3 blocking the bishop. bxa4 instead loses to Bxa4.
    expect(assessFen("4k3/8/8/qp6/P2N4/1P1p4/R1b5/7K w - - 0 1").find((a) => a.move.san === "Kh2")?.loss).toBe(0);
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

  it("plays a check that forces mate on the next move, and nothing else", () => {
    // King on g5, queen on f7, black king on g8. Stepping the king up mates next move.
    expect(shortlist(assessFen("6k1/5Q2/8/6K1/8/8/8/8 w - - 0 1")).map((a) => a.move.san).sort()).toEqual(["Kf6+", "Kg6+"]);
  });

  it("plays a mate it can force in three by checks, and nothing else", () => {
    // The smothered mate: Nh6+ Kh8, Qg8+ Rxg8, Nf7#.
    expect(shortlist(assessFen("5rk1/5Npp/8/8/2Q5/8/8/6K1 w - - 0 1")).map((a) => a.move.san)).toEqual(["Nh6+"]);
  });

  it("when hunting a bare king, plays a mate that begins with a quiet move", () => {
    // King f6 and queen e1 against a king on h8: Kf7 leaves only Kh7, and Qh1 mates. No check forces it as fast.
    const forced = shortlist(assessFen("7k/8/5K2/8/8/8/8/4Q3 w - - 0 1")).map((a) => a.move.san).sort();
    expect(forced).toEqual(["Kf7", "Kg6", "Qe7", "Qg1", "Qg3"]);
  });

  it("does not go back to a position the game has been in, while its side is well ahead", () => {
    // King and queen against king. After Qd3 Kf6, Qd2 Ke5 the first position is back, and Qd3 would bring back the second.
    const fen = "8/8/8/4k3/8/8/3Q4/4K3 w - - 0 1";
    const again = assessMoves(["Qd3", "Kf6", "Qd2", "Ke5"], fen);
    expect(again.find((a) => a.move.san === "Qd3")).toMatchObject({ repeats: true });
    expect(again.find((a) => a.move.san === "Qd4+")).toMatchObject({ repeats: false });
    expect(shortlist(again).map((a) => a.move.san)).not.toContain("Qd3");
    // The same move the first time round is like any other.
    expect(assessMoves([], fen).find((a) => a.move.san === "Qd3")).toMatchObject({ repeats: false });
  });

  it("goes back to an earlier position when its side is not well ahead, or has nothing else", () => {
    const level = assessMoves([]).map((a) => ({ ...a, repeats: a.move.san !== "e4" }));
    expect(shortlist(level)).toHaveLength(20);
    const ahead = assessMoves([]).map((a) => ({ ...a, lead: 5, repeats: true }));
    expect(shortlist(ahead)).toHaveLength(20);
  });

  it("drops a move that draws at once while its side is not behind", () => {
    // The queen already covers every square next to the black king, so Ka2 is stalemate.
    const moves = shortlist(assessFen("7k/5Q2/8/8/8/8/8/K7 w - - 0 1")).map((a) => a.move.san);
    expect(moves).not.toContain("Ka2");
    expect(moves.length).toBeGreaterThan(0);
  });

  it("keeps a draw when its side is behind", () => {
    const behind = assessMoves([]).map((a) => ({ ...a, draw: a.move.san === "e4", lead: -3, hunt: false }));
    expect(shortlist(behind).some((a) => a.move.san === "e4")).toBe(true);
    const level = assessMoves([]).map((a) => ({ ...a, draw: a.move.san === "e4", hunt: false }));
    expect(shortlist(level).some((a) => a.move.san === "e4")).toBe(false);
  });

  it("when hunting a bare king, only offers the moves that shut it in the smallest part of the board", () => {
    const all = assessFen("8/8/8/4k3/8/8/8/KQ6 w - - 0 1");
    const kept = shortlist(all);
    const smallest = Math.min(...all.filter((a) => !a.draw && !a.mate && a.score === 0).map((a) => a.box));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(3);
    expect(kept.every((a) => a.box === smallest)).toBe(true);
  });

  it("counts the squares a hunted king is shut in with", () => {
    // A rook on a4 holds the king, on e5, to the four ranks beyond it, less the four squares it covers on the a-file.
    const cut = assessFen("8/8/8/4k3/8/8/R7/4K3 w - - 0 1").find((a) => a.move.san === "Ra4")!;
    expect(cut).toMatchObject({ hunt: true, box: 28 });
    // Outside a hunt it is not worked out.
    expect(assessMoves([]).every((a) => a.box === 0)).toBe(true);
  });

  it("keeps every move when all of them allow mate", () => {
    // Black to move, about to be mated on the back rank whatever happens.
    const all = assessMoves([]).map((a) => ({ ...a, allowsMate: true }));
    expect(shortlist(all)).toHaveLength(20);
  });
});
