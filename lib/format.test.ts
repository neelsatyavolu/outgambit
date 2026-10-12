import { describe, expect, it } from "vitest";
import { capturedPieces, formatClock, headline, materialLead, outcomeText, reasonText } from "./format";

describe("outcomeText", () => {
  const game = { status: "finished", result: "white", reason: "checkmate", playerColor: "white" } as const;

  it("says how the player's finished game went, and why", () => {
    expect(outcomeText(game)).toBe("won · checkmate");
    expect(outcomeText({ ...game, playerColor: "black", reason: "timeout" })).toBe("lost · time");
    expect(outcomeText({ ...game, result: "draw", reason: "stalemate" })).toBe("draw · stalemate");
  });

  it("marks games with no result", () => {
    expect(outcomeText({ ...game, status: "active", result: null, reason: null })).toBe("live");
    expect(outcomeText({ ...game, status: "aborted", result: null, reason: "provider_error" })).toBe("aborted");
  });
});

describe("formatClock", () => {
  it("shows minutes, seconds and milliseconds", () => {
    expect(formatClock(600_000)).toBe("10:00.000");
    expect(formatClock(65_237)).toBe("1:05.237");
  });

  it("preserves the last millisecond and second boundaries", () => {
    expect(formatClock(59_001)).toBe("0:59.001");
    expect(formatClock(10_000)).toBe("0:10.000");
    expect(formatClock(1)).toBe("0:00.001");
    expect(formatClock(0.1)).toBe("0:00.001");
  });

  it("keeps all three digits under ten seconds", () => {
    expect(formatClock(9_940)).toBe("0:09.940");
    expect(formatClock(450)).toBe("0:00.450");
  });

  it("shows hours when there are any", () => {
    expect(formatClock(3_725_019)).toBe("1:02:05.019");
  });

  it("never goes below zero", () => {
    expect(formatClock(-500)).toBe("0:00.000");
  });
});

describe("headline", () => {
  const base = { status: "finished", playerColor: "white", modelLabel: "GPT A", turn: "white" } as const;

  it("tells the player they won", () => {
    expect(headline({ ...base, result: "white", reason: "checkmate" }, false)).toEqual({
      title: "You won", detail: "Checkmate.",
    });
  });

  it("tells the player they lost", () => {
    expect(headline({ ...base, result: "black", reason: "timeout" }, false)).toEqual({
      title: "You lost", detail: "You ran out of time.",
    });
  });

  it("explains an AI forfeit", () => {
    expect(headline({ ...base, result: "white", reason: "illegal_move" }, false)?.detail).toBe(
      "GPT A could not produce a legal move and forfeited.",
    );
  });

  it("describes a draw", () => {
    expect(headline({ ...base, result: "draw", reason: "repetition" }, false)).toEqual({
      title: "Draw", detail: "The same position occurred three times.",
    });
  });

  it("explains an aborted game", () => {
    expect(headline({ ...base, status: "aborted", result: null, reason: "provider_error" }, false)).toEqual({
      title: "Game aborted", detail: "GPT A is unavailable. This game does not count toward your daily limit.",
    });
  });

  it("names the sides for a spectator", () => {
    expect(headline({ ...base, result: "black", reason: "resignation" }, true)).toEqual({
      title: "GPT A won", detail: "The player resigned.",
    });
    expect(headline({ ...base, result: "white", reason: "timeout" }, true)).toEqual({
      title: "The player won", detail: "GPT A ran out of time.",
    });
  });

  it("returns null while the game is in progress", () => {
    expect(headline({ ...base, status: "active", result: null, reason: null }, false)).toBeNull();
  });
});

describe("reasonText", () => {
  it("has a short label for every reason", () => {
    expect(reasonText("fifty_move")).toBe("fifty-move rule");
    expect(reasonText("provider_error")).toBe("AI unavailable");
  });
});

describe("capturedPieces", () => {
  it("finds nothing missing at the start", () => {
    expect(capturedPieces("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toEqual({ white: [], black: [] });
  });

  it("lists each side's lost pieces, most valuable first", () => {
    // White has lost a queen and a pawn; black has lost a rook.
    expect(capturedPieces("1nbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNB1KBNR w KQk - 0 1")).toEqual({
      white: ["q", "p"], black: ["r"],
    });
  });

  it("does not report promoted pieces as negative losses", () => {
    expect(capturedPieces("QQ2k3/8/8/8/8/8/8/4K3 w - - 0 1").white).toEqual(["r", "r", "b", "b", "n", "n", "p", "p", "p", "p", "p", "p", "p", "p"]);
  });
});

describe("materialLead", () => {
  it("is nothing at the start", () => {
    expect(materialLead("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "white")).toBe(0);
  });

  it("is how far ahead a side is on the pieces left, in pawns, and negative for the side behind", () => {
    // White is missing a queen and a pawn (10); black is missing a rook (5).
    const fen = "1nbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNB1KBNR w KQk - 0 1";
    expect(materialLead(fen, "black")).toBe(5);
    expect(materialLead(fen, "white")).toBe(-5);
  });

  it("counts a promoted queen as a queen", () => {
    expect(materialLead("Q3k3/8/8/8/8/8/8/4K3 w - - 0 1", "white")).toBe(9);
  });
});
