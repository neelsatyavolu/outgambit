import { Chess, type Color as Side, type Square } from "chess.js";
import { HUNT_LIMITS, MATE_LIMITS, forcedMates } from "./mate";
import type { LegalMove } from "./rules";

/**
 * One-move tactics, worked out in code, plus any checkmate that can be
 * forced within three moves. Models that cannot calculate are only shown
 * moves that survive this, so they choose among sound moves and never have to
 * count attackers themselves.
 */
export type Assessed = {
  move: LegalMove;
  /** The move is checkmate. */
  mate: boolean;
  /** The opponent has a checkmate in reply. */
  allowsMate: boolean;
  /** The move ends the game as a draw. */
  draw: boolean;
  /** Whatever the opponent replies, mate follows within two more moves. */
  forcesMate: boolean;
  /** The move goes back to a position the game has already been in. */
  repeats: boolean;
  /** Material won at once: the piece taken, plus what a promotion adds. */
  gain: number;
  /** The most valuable piece the opponent could then win. */
  loss: number;
  score: number;
  /** Squares the enemy king could step to after this move. */
  flight: number;
  /**
   * Squares the enemy king could ever walk to after this move without
   * stepping onto one that is attacked: the box it is shut in. Counted only
   * in a hunt.
   */
  box: number;
  /** King-steps gained toward the enemy king. Negative when the king walks away. */
  closer: number;
  /** Material lead of the side to move, in pawns, before the move. */
  lead: number;
  /** Ahead, and the other side has nothing bigger than a knight: time to mate. */
  hunt: boolean;
};

export const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** A side this far ahead, with the other side down to a minor piece or less, should be mating. */
const HUNT_LEAD = 3;
/** The most moves offered in a hunt. More than this and a pick among them stops making progress. */
const HUNT_OPTIONS = 3;

const other = (side: Side): Side => (side === "w" ? "b" : "w");
const fileOf = (square: string): number => square.charCodeAt(0) - 97;
const rankOf = (square: string): number => Number(square[1]);
const kingSteps = (a: string, b: string): number =>
  Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));

function kingAt(chess: Chess, side: Side): string | null {
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece?.type === "k" && piece.color === side) return piece.square;
    }
  }
  return null;
}

const squareAt = (file: number, rank: number): Square => `${String.fromCharCode(97 + file)}${rank}` as Square;

/**
 * How many squares the king on `from` could ever walk to, itself included,
 * without stepping onto a square the other side attacks. Driving this down
 * is what forces a lone king to the edge: a rook cuts the board in two, and
 * the king is left the smaller part. Every piece counts as a wall, the
 * hunter's too: one the king could take is already counted as a loss.
 */
function boxSize(chess: Chess, from: string, king: Side): number {
  const reached = new Set([from]);
  const frontier = [from];
  while (frontier.length > 0) {
    const square = frontier.pop()!;
    for (let file = fileOf(square) - 1; file <= fileOf(square) + 1; file++) {
      for (let rank = rankOf(square) - 1; rank <= rankOf(square) + 1; rank++) {
        if (file < 0 || file > 7 || rank < 1 || rank > 8) continue;
        const next = squareAt(file, rank);
        if (reached.has(next) || chess.get(next) || chess.isAttacked(next, other(king))) continue;
        reached.add(next);
        frontier.push(next);
      }
    }
  }
  return reached.size;
}

function material(chess: Chess, side: Side): { all: number; pieces: number } {
  let all = 0;
  let pieces = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece?.color !== side) continue;
      const value = VALUES[piece.type];
      all += value;
      if (piece.type !== "p") pieces += value;
    }
  }
  return { all, pieces };
}

/**
 * What `side` stands to lose on its worst-placed piece: taken for free, or by
 * something cheaper. A king is not counted as an attacker of a defended piece,
 * because it cannot take one.
 */
function worstLoss(chess: Chess, side: Side): number {
  let worst = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== side || piece.type === "k") continue;
      const value = VALUES[piece.type];
      if (value <= worst) continue;
      const attackers = chess.attackers(piece.square, other(side));
      if (attackers.length === 0) continue;
      const defended = chess.attackers(piece.square, side).length > 0;
      const cheapest = Math.min(
        ...attackers.map((sq) => {
          const attacker = chess.get(sq as Square)!.type;
          return attacker === "k" && defended ? Number.POSITIVE_INFINITY : VALUES[attacker];
        }),
      );
      if (!defended || cheapest < value) worst = value;
    }
  }
  return worst;
}

/** What makes two positions the same for repetition: the pieces, whose move it is, and the castling and en passant rights. */
const positionKey = (chess: Chess): string => chess.fen().split(" ").slice(0, 4).join(" ");

/** Assesses every legal move on the board. `seen` is the positions the game has been through to get here. */
function assessChess(chess: Chess, seen: ReadonlySet<string>): Assessed[] {
  const side = chess.turn();
  const ours = material(chess, side);
  const theirs = material(chess, other(side));
  const lead = ours.all - theirs.all;
  const hunt = lead >= HUNT_LEAD && theirs.pieces <= VALUES.n;
  // A king being hunted has few replies, and the mates against it begin with quiet moves, so there every move is tried.
  const forcing = new Set(forcedMates(chess, hunt ? HUNT_LIMITS : MATE_LIMITS));
  const ourKing = kingAt(chess, side);
  const enemyKing = kingAt(chess, other(side));
  const gapBefore = ourKing && enemyKing ? kingSteps(ourKing, enemyKing) : 0;
  return chess.moves({ verbose: true }).map((m) => {
    chess.move(m.san);
    const mate = chess.isCheckmate();
    const draw = !mate && chess.isDraw();
    const allowsMate = !mate && !draw && chess.moves().some((reply) => reply.endsWith("#"));
    const loss = mate ? 0 : worstLoss(chess, side);
    const flight = mate || draw || !enemyKing ? 0 : chess.moves({ square: enemyKing as Square }).length;
    const repeats = seen.has(positionKey(chess));
    const box = hunt && !mate && !draw && enemyKing ? boxSize(chess, enemyKing, other(side)) : 0;
    chess.undo();
    const ourAfter = m.piece === "k" ? m.to : ourKing;
    const closer = ourAfter && enemyKing ? gapBefore - kingSteps(ourAfter, enemyKing) : 0;
    const gain = (m.captured ? VALUES[m.captured] : 0) + (m.promotion ? VALUES[m.promotion] - VALUES.p : 0);
    const move: LegalMove = {
      san: m.san, uci: m.lan, from: m.from, to: m.to, piece: m.piece,
      ...(m.captured ? { captured: m.captured } : {}),
      ...(m.promotion ? { promotion: m.promotion } : {}),
      check: m.san.endsWith("+"), mate: m.san.endsWith("#"),
    };
    return {
      move, mate, allowsMate, draw, forcesMate: !mate && forcing.has(m.san), repeats, gain, loss, score: gain - loss,
      flight, box, closer, lead, hunt,
    };
  });
}

/** Assesses every legal move in the position reached by `history`, played from the start or from `fen`. */
export function assessMoves(history: readonly string[], fen?: string): Assessed[] {
  const chess = new Chess(fen);
  const seen = new Set([positionKey(chess)]);
  for (const san of history) {
    chess.move(san);
    seen.add(positionKey(chess));
  }
  // The position on the board is the one being left, not one a move could go back to.
  seen.delete(positionKey(chess));
  return assessChess(chess, seen);
}

/** The same for a position given as a FEN, with no game behind it to repeat. */
export function assessFen(fen: string): Assessed[] {
  return assessMoves([], fen);
}

/** Orders two moves in a hunt: negative when `a` does more to shut the king in than `b`. */
const hunting = (a: Assessed, b: Assessed): number => a.box - b.box || b.closer - a.closer || a.flight - b.flight;

/**
 * The moves worth choosing between. A mate in one, or the moves that force a
 * mate within three, are the whole list. Otherwise the moves that do not
 * allow mate and come out best on material. A draw is dropped while the side
 * to move is not behind, and a move back to an earlier position while it is
 * well ahead. When that side is hunting a bare king, only the moves that
 * shut it in the smallest part of the board stay: a check that lets it out
 * is no progress.
 */
export function shortlist(assessed: readonly Assessed[]): Assessed[] {
  const mates = assessed.filter((a) => a.mate);
  if (mates.length > 0) return mates.slice(0, 1);
  const forced = assessed.filter((a) => a.forcesMate);
  if (forced.length > 0) return forced;
  const safe = assessed.filter((a) => !a.allowsMate);
  let pool = safe.length > 0 ? safe : [...assessed];
  const best = Math.max(...pool.map((a) => a.score));
  pool = pool.filter((a) => a.score === best);
  const lead = assessed[0]?.lead ?? 0;
  if (lead >= 0) {
    const playing = pool.filter((a) => !a.draw);
    if (playing.length > 0) pool = playing;
  }
  // A side that is winning gets nowhere by going round in circles, and draws if it does so three times.
  if (lead >= HUNT_LEAD) {
    const fresh = pool.filter((a) => !a.repeats);
    if (fresh.length > 0) pool = fresh;
  }
  if (assessed[0]?.hunt && pool.length > 1) {
    // Only the moves that do the most: the smallest box, then the kings closest, then the fewest squares to step to.
    const best = pool.reduce((top, a) => (hunting(a, top) < 0 ? a : top));
    pool = pool.filter((a) => hunting(a, best) === 0).slice(0, HUNT_OPTIONS);
  }
  return pool;
}
