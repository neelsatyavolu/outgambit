import { Chess, type Color as Side, type Square } from "chess.js";
import type { LegalMove } from "./rules";

/**
 * One-move tactics, worked out in code. Models that cannot calculate (Jev)
 * are only shown moves that survive this check, so they choose among sound
 * moves and never have to count attackers themselves.
 */
export type Assessed = {
  move: LegalMove;
  /** The move is checkmate. */
  mate: boolean;
  /** The opponent has a checkmate in reply. */
  allowsMate: boolean;
  /** Material won at once: the piece taken, plus what a promotion adds. */
  gain: number;
  /** The most valuable piece the opponent could then win. */
  loss: number;
  score: number;
};

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const other = (side: Side): Side => (side === "w" ? "b" : "w");

/** What `side` stands to lose on its worst-placed piece: taken for free, or by something cheaper. */
function worstLoss(chess: Chess, side: Side): number {
  let worst = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== side || piece.type === "k") continue;
      const value = VALUES[piece.type];
      if (value <= worst) continue;
      const attackers = chess.attackers(piece.square, other(side));
      if (attackers.length === 0) continue;
      const cheapest = Math.min(...attackers.map((sq) => VALUES[chess.get(sq as Square)!.type]));
      const defended = chess.attackers(piece.square, side).length > 0;
      if (!defended || cheapest < value) worst = value;
    }
  }
  return worst;
}

/** Assesses every legal move in the position reached by `history`. */
export function assessMoves(history: readonly string[]): Assessed[] {
  const chess = new Chess();
  for (const san of history) chess.move(san);
  const side = chess.turn();
  return chess.moves({ verbose: true }).map((m) => {
    chess.move(m.san);
    const mate = chess.isCheckmate();
    const allowsMate = !mate && chess.moves().some((reply) => reply.endsWith("#"));
    const loss = mate ? 0 : worstLoss(chess, side);
    chess.undo();
    const gain = (m.captured ? VALUES[m.captured] : 0) + (m.promotion ? VALUES[m.promotion] - VALUES.p : 0);
    const move: LegalMove = {
      san: m.san, uci: m.lan, from: m.from, to: m.to, piece: m.piece,
      ...(m.captured ? { captured: m.captured } : {}),
      ...(m.promotion ? { promotion: m.promotion } : {}),
      check: m.san.endsWith("+"), mate: m.san.endsWith("#"),
    };
    return { move, mate, allowsMate, gain, loss, score: gain - loss };
  });
}

/**
 * The moves worth choosing between: a mate if there is one; otherwise the
 * moves that do not allow mate and come out best on material.
 */
export function shortlist(assessed: readonly Assessed[]): Assessed[] {
  const mates = assessed.filter((a) => a.mate);
  if (mates.length > 0) return mates.slice(0, 1);
  const safe = assessed.filter((a) => !a.allowsMate);
  const pool = safe.length > 0 ? safe : [...assessed];
  const best = Math.max(...pool.map((a) => a.score));
  return pool.filter((a) => a.score === best);
}
