import { Chess } from "chess.js";
import { assessMoves, shortlist, VALUES } from "@/lib/chess/tactics";

/**
 * Won endgames played out with no model at all: the side that is winning
 * picks at random from the moves code leaves it. That measures the help code
 * gives on its own, which is all a model that cannot calculate has to go on.
 */
export const WON_ENDGAMES = {
  "queen": "8/8/8/4k3/8/8/3Q4/4K3 w - - 0 1",
  "rook": "8/8/8/4k3/8/8/3R4/4K3 w - - 0 1",
  "two rooks": "8/8/8/4k3/8/8/R7/1R2K3 w - - 0 1",
  "queen and pawns against pawns": "8/5ppp/8/4k3/8/8/3Q1PPP/6K1 w - - 0 1",
  "rook and pawns against pawns": "8/6pp/8/4k3/8/8/3R2PP/6K1 w - - 0 1",
  "queen against knight": "8/8/8/4k3/5n2/8/3Q4/4K3 w - - 0 1",
  "rook and bishop": "8/8/8/4k3/8/8/3R4/2B1K3 w - - 0 1",
} as const;

export type Defender = "random" | "stubborn";
export type PlayedOut = { outcome: "mate" | "lost" | "draw" | "unfinished"; moves: number };

/** A small repeatable random source, so a game can be played again exactly. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const pick = <T>(items: readonly T[], rng: () => number): T => items[Math.floor(rng() * items.length)];

/** How many king steps a square is from the four in the middle. */
function fromCentre(square: string): number {
  const off = (index: number) => (index <= 3 ? 3 - index : index - 4);
  return Math.max(off(square.charCodeAt(0) - 97), off(Number(square[1]) - 1));
}

/** The harder of the two defenders: it takes whatever it can, and otherwise keeps its king in the middle of the board. */
function stubbornMove(chess: Chess, rng: () => number): string {
  const legal = chess.moves({ verbose: true });
  const captures = legal.filter((m) => m.captured).sort((a, b) => VALUES[b.captured!] - VALUES[a.captured!]);
  if (captures.length > 0) return captures[0].san;
  const kingMoves = legal.filter((m) => m.piece === "k");
  if (kingMoves.length === 0) return pick(legal, rng).san;
  const nearest = Math.min(...kingMoves.map((m) => fromCentre(m.to)));
  return pick(kingMoves.filter((m) => fromCentre(m.to) === nearest), rng).san;
}

/** Plays `fen` out for at most `most` moves a side. The side to move in `fen` is the one being helped. */
export function playOut(fen: string, defender: Defender, seed: number, most = 50): PlayedOut {
  const rng = seeded(seed);
  const chess = new Chess(fen);
  const helped = chess.turn();
  const history: string[] = [];
  for (let ply = 0; ply < most * 2; ply++) {
    const moves = Math.ceil(ply / 2);
    if (chess.isCheckmate()) return { outcome: chess.turn() === helped ? "lost" : "mate", moves };
    if (chess.isDraw()) return { outcome: "draw", moves };
    const san =
      chess.turn() === helped
        ? pick(shortlist(assessMoves(history, fen)), rng).move.san
        : defender === "random"
          ? pick(chess.moves(), rng)
          : stubbornMove(chess, rng);
    history.push(chess.move(san).san);
  }
  return { outcome: "unfinished", moves: most };
}
