import { Chess } from "chess.js";
import type { Color, Reason, Result } from "../game/types";

export type LegalMove = {
  san: string;
  uci: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  check: boolean;
  mate: boolean;
};

export type Outcome = { result: Result; reason: Reason } | null;

export type Position = { fen: string; turn: Color; legal: LegalMove[]; outcome: Outcome };
export type Applied = { san: string; uci: string; fen: string; outcome: Outcome };

const colorOf = (turn: "w" | "b"): Color => (turn === "w" ? "white" : "black");

const draw = (reason: Reason): Outcome => ({ result: "draw", reason });

export function outcomeOf(chess: Chess): Outcome {
  if (chess.isCheckmate()) {
    // The side to move is the one that has been mated.
    return { result: chess.turn() === "w" ? "black" : "white", reason: "checkmate" };
  }
  if (chess.isStalemate()) return draw("stalemate");
  if (chess.isInsufficientMaterial()) return draw("insufficient_material");
  if (chess.isThreefoldRepetition()) return draw("repetition");
  if (chess.isDrawByFiftyMoves()) return draw("fifty_move");
  return null;
}

function legalMoves(chess: Chess): LegalMove[] {
  return chess.moves({ verbose: true }).map((m) => ({
    san: m.san,
    uci: m.lan,
    from: m.from,
    to: m.to,
    piece: m.piece,
    ...(m.captured ? { captured: m.captured } : {}),
    ...(m.promotion ? { promotion: m.promotion } : {}),
    check: m.san.endsWith("+"),
    mate: m.san.endsWith("#"),
  }));
}

// Repetition depends on the whole game, so positions are rebuilt from the
// move list, not loaded from a FEN.
function build(history: readonly string[]): Chess {
  const chess = new Chess();
  for (const san of history) chess.move(san);
  return chess;
}

/** Rebuilds the position reached by `history` (SAN moves from the start). */
export function replay(history: readonly string[]): Position {
  const chess = build(history);
  return { fen: chess.fen(), turn: colorOf(chess.turn()), legal: legalMoves(chess), outcome: outcomeOf(chess) };
}

/** Plays one move, given as UCI or SAN. Returns null when it is not legal. */
export function applyMove(history: readonly string[], move: string): Applied | null {
  const chess = build(history);
  const chosen = legalMoves(chess).find((m) => m.uci === move || m.san === move);
  if (!chosen) return null;
  chess.move(chosen.san);
  return { san: chosen.san, uci: chosen.uci, fen: chess.fen(), outcome: outcomeOf(chess) };
}
