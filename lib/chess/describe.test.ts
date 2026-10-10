import { describe, expect, it } from "vitest";
import { describeMove, textBoard } from "./describe";
import { replay } from "./rules";

const find = (history: string[], san: string) => replay(history).legal.find((m) => m.san === san)!;

describe("textBoard", () => {
  it("draws the starting position from white's side with labels", () => {
    expect(textBoard(replay([]).fen)).toBe(
      [
        "8 r n b q k b n r",
        "7 p p p p p p p p",
        "6 . . . . . . . .",
        "5 . . . . . . . .",
        "4 . . . . . . . .",
        "3 . . . . . . . .",
        "2 P P P P P P P P",
        "1 R N B Q K B N R",
        "  a b c d e f g h",
      ].join("\n"),
    );
  });
});

describe("describeMove", () => {
  it("describes a quiet move", () => {
    expect(describeMove(find([], "Nf3"))).toBe("Knight from g1 to f3");
  });

  it("describes a capture", () => {
    expect(describeMove(find(["e4", "d5"], "exd5"))).toBe("Pawn from e4 to d5, captures pawn");
  });

  it("describes checkmate", () => {
    expect(describeMove(find(["f3", "e5", "g4"], "Qh4#"))).toBe("Queen from d8 to h4, checkmate");
  });

  it("describes castling", () => {
    expect(describeMove(find(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"], "O-O"))).toBe("Castles kingside");
  });

  it("describes a promotion with capture", () => {
    const history = ["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6"];
    expect(describeMove(find(history, "bxa8=Q"))).toBe("Pawn from b7 to a8, captures rook, promotes to queen");
  });
});
