import { describe, expect, it } from "vitest";
import { isLegalMove, placementOf, premoveTargets, premoveUci, withPremoves } from "./premove";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const sorted = (squares: string[]) => [...squares].sort();

describe("placementOf", () => {
  it("reads every piece off a position", () => {
    const placement = placementOf(START);
    expect(Object.keys(placement)).toHaveLength(32);
    expect(placement.e2).toEqual({ color: "w", type: "p" });
    expect(placement.d8).toEqual({ color: "b", type: "q" });
    expect(placement.e4).toBeUndefined();
  });
});

describe("premoveTargets", () => {
  const start = placementOf(START);

  it("lets a pawn on its home rank step, double-step or capture either way", () => {
    expect(sorted(premoveTargets(start, "e2", "KQkq"))).toEqual(["d3", "e3", "e4", "f3"]);
    expect(sorted(premoveTargets(start, "e7", "KQkq"))).toEqual(["d6", "e5", "e6", "f6"]);
  });

  it("gives a pawn off its home rank no double step", () => {
    const placement = placementOf("4k3/8/8/8/8/4P3/8/4K3 w - - 0 1");
    expect(sorted(premoveTargets(placement, "e3", "-"))).toEqual(["d4", "e4", "f4"]);
  });

  it("includes squares held by the mover's own pieces, which may be taken first", () => {
    expect(sorted(premoveTargets(start, "g1", "KQkq"))).toEqual(["e2", "f3", "h3"]);
  });

  it("lets sliding pieces pass through whatever is in the way today", () => {
    const bishop = premoveTargets(start, "c1", "KQkq");
    expect(bishop).toContain("h6");
    expect(bishop).toContain("a3");
    expect(bishop).not.toContain("c2");
    const rook = premoveTargets(start, "a1", "KQkq");
    expect(rook).toContain("a8");
    expect(rook).toContain("h1");
    expect(rook).not.toContain("b2");
    expect(premoveTargets(start, "d1", "KQkq")).toEqual(expect.arrayContaining(["d8", "h5", "a4", "a1"]));
  });

  it("never offers the square the piece stands on, and nothing for an empty square", () => {
    expect(premoveTargets(start, "d1", "KQkq")).not.toContain("d1");
    expect(premoveTargets(start, "e4", "KQkq")).toEqual([]);
  });

  it("offers castling only with the right, the king at home and the rook in its corner", () => {
    expect(sorted(premoveTargets(start, "e1", "KQkq"))).toEqual(["c1", "d1", "d2", "e2", "f1", "f2", "g1"]);
    expect(premoveTargets(start, "e1", "Qkq")).not.toContain("g1");
    expect(premoveTargets(start, "e1", "-")).not.toContain("c1");
    expect(premoveTargets(start, "e8", "KQkq")).toEqual(expect.arrayContaining(["g8", "c8"]));
    const noRook = placementOf("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(premoveTargets(noRook, "e1", "KQ")).not.toContain("g1");
    const kingMoved = placementOf("4k3/8/8/8/8/8/4K3/R6R w - - 0 1");
    expect(premoveTargets(kingMoved, "e2", "KQ")).not.toContain("g2");
  });
});

describe("withPremoves", () => {
  it("returns the position unchanged when nothing is queued", () => {
    expect(withPremoves(START, [])).toEqual(placementOf(START));
  });

  it("draws each queued move as if it had been played, in order", () => {
    const placement = withPremoves(START, ["g1f3", "f3e5"]);
    expect(placement.g1).toBeUndefined();
    expect(placement.f3).toBeUndefined();
    expect(placement.e5).toEqual({ color: "w", type: "n" });
  });

  it("replaces whatever stands on the destination", () => {
    expect(withPremoves(START, ["d1d7"]).d7).toEqual({ color: "w", type: "q" });
  });

  it("brings the rook across when the king castles", () => {
    const short = withPremoves(START, ["e1g1"]);
    expect(short.g1).toEqual({ color: "w", type: "k" });
    expect(short.f1).toEqual({ color: "w", type: "r" });
    expect(short.h1).toBeUndefined();
    const long = withPremoves(START, ["e8c8"]);
    expect(long.c8).toEqual({ color: "b", type: "k" });
    expect(long.d8).toEqual({ color: "b", type: "r" });
    expect(long.a8).toBeUndefined();
  });

  it("promotes to the piece the move names", () => {
    const placement = withPremoves("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", ["a7a8q"]);
    expect(placement.a8).toEqual({ color: "w", type: "q" });
  });

  it("ignores a move from an empty square", () => {
    expect(withPremoves(START, ["e4e5"])).toEqual(placementOf(START));
  });
});

describe("premoveUci", () => {
  it("writes the move, promoting a pawn that reaches the last rank to a queen", () => {
    const placement = placementOf("4k3/P7/8/8/8/8/p7/4K3 w - - 0 1");
    expect(premoveUci(placement, "a7", "a8")).toBe("a7a8q");
    expect(premoveUci(placement, "a2", "b1")).toBe("a2b1q");
    expect(premoveUci(placement, "e1", "e2")).toBe("e1e2");
    expect(premoveUci(placementOf(START), "e2", "e4")).toBe("e2e4");
  });
});

describe("isLegalMove", () => {
  it("accepts a legal move and refuses anything else", () => {
    expect(isLegalMove(START, "e2e4")).toBe(true);
    expect(isLegalMove(START, "e2e5")).toBe(false);
    expect(isLegalMove(START, "e7e5")).toBe(false);
    expect(isLegalMove(START, "d1h5")).toBe(false);
    expect(isLegalMove("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8q")).toBe(true);
  });
});
