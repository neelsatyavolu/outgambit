import { Chess, type Color as Side, type Move, type Square } from "chess.js";
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
  /** Material the opponent can win after legal captures and recaptures. */
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

const captureValue = (move: Move): number =>
  (move.captured ? VALUES[move.captured] : 0) + (move.promotion ? VALUES[move.promotion] - VALUES.p : 0);

/**
 * A static exchange: try legal attackers cheapest first, and allow either
 * side to decline a losing recapture. Only one square is searched; every
 * capture removes a piece. Making the moves also
 * reveals x-rays and excludes pinned defenders and illegal king captures.
 */
function exchange(chess: Chess, target: Square): number {
  const victim = chess.get(target);
  if (!victim || victim.type === "k") return 0;
  const attackers = chess.attackers(target, chess.turn()).sort((a, b) => {
    const value = (square: Square) => {
      const piece = chess.get(square)!;
      return piece.type === "k" ? 100 : VALUES[piece.type];
    };
    return value(a) - value(b);
  });
  let best = 0;
  for (const from of attackers) {
    let move: Move;
    try {
      move = chess.move({ from, to: target, promotion: "q" });
    } catch {
      // Geometric attackers include pieces pinned to their king.
      continue;
    }
    const value = captureValue(move);
    const gain = value - exchange(chess, target);
    chess.undo();
    best = Math.max(best, gain);
    // No recapture can win more than the piece on this square.
    if (best === value) break;
  }
  return best;
}

/** The opponent's best immediate material win, with the exchange resolved. */
function worstLoss(chess: Chess, replies: readonly string[]): number {
  let worst = 0;
  for (const san of replies) {
    if (!san.includes("x") && !san.includes("=")) continue;
    const reply = chess.move(san);
    const gain = captureValue(reply);
    // A promotion that stalemates adds no usable material, but a captured
    // rook or queen is still lost even if only kings remain afterwards.
    const net = gain <= worst ? 0 : reply.promotion && chess.isDraw()
      ? (reply.captured ? VALUES[reply.captured] : 0) : gain - exchange(chess, reply.to);
    chess.undo();
    worst = Math.max(worst, net);
  }
  return worst;
}

/**
 * A checking fork forces a response before the threatened piece can move.
 * Try every evasion, then resolve the next capture. An incomplete scan says
 * nothing; at most 32 evasions are evaluated across the entire position.
 */
function checkingLoss(chess: Chess, replies: readonly string[], loss: number, budget: { left: number }): number {
  for (const san of replies) {
    if (budget.left <= 0) break;
    if (!san.endsWith("+") || san.startsWith("K")) continue;
    const reply = chess.move(san);
    const fork = chess.board().flat().some((piece) =>
      piece && piece.color === chess.turn() && VALUES[piece.type] >= VALUES.n &&
      chess.attackers(piece.square, reply.color).includes(reply.to),
    );
    if (fork) {
      const evasions = chess.moves();
      if (evasions.length <= budget.left) {
        let best = Number.POSITIVE_INFINITY;
        for (const evasion of evasions) {
          budget.left -= 1;
          const response = chess.move(evasion);
          const next = response.san.endsWith("#") || chess.isDraw() ? [] : chess.moves();
          const threat = next.some((move) => move.endsWith("#")) ? 100 : worstLoss(chess, next);
          best = Math.min(best, captureValue(reply) - captureValue(response) + threat);
          chess.undo();
          // One evasion saving the material is enough to disprove the fork.
          if (best <= loss) break;
        }
        loss = Math.max(loss, best);
      }
    }
    chess.undo();
  }
  return loss;
}

/** A full minor piece. A rook for a knight is two, and that is not treated as losing the move. */
const LOOM_NET = 3;
/** Quiet threats looked at across one position. An unfinished look is not a loss. */
const LOOM_BUDGET = 160;
/** Answers tried against one threat: take the attacker, or move the piece it attacks. */
const LOOM_TRIES = 8;

/** The board with the side to move swapped and en passant cleared, as if the mover passed. */
function passedLoss(chess: Chess): number {
  const fen = chess.fen().split(" ");
  fen[1] = fen[1] === "w" ? "b" : "w";
  fen[3] = "-";
  try {
    const passed = new Chess(fen.join(" "));
    return worstLoss(passed, passed.moves());
  } catch {
    return 0;
  }
}

const KNIGHT_STEPS: readonly [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const BISHOP_RAYS: readonly [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_RAYS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const QUEEN_RAYS: readonly [number, number][] = [...BISHOP_RAYS, ...ROOK_RAYS];

/**
 * Squares `type` on `to` would attack. `vacant` is the square it leaves, which no longer blocks a ray.
 * The piece is not moved: this only reads the board.
 */
function attackedSquares(chess: Chess, to: Square, type: string, color: Side, vacant: Square): Square[] {
  const file = fileOf(to);
  const rank = rankOf(to);
  const out: Square[] = [];
  if (type === "n") {
    for (const [df, dr] of KNIGHT_STEPS) {
      const f = file + df;
      const r = rank + dr;
      if (f >= 0 && f <= 7 && r >= 1 && r <= 8) out.push(squareAt(f, r));
    }
    return out;
  }
  if (type === "p") {
    const next = rank + (color === "w" ? 1 : -1);
    if (next < 1 || next > 8) return out;
    if (file > 0) out.push(squareAt(file - 1, next));
    if (file < 7) out.push(squareAt(file + 1, next));
    return out;
  }
  const rays = type === "b" ? BISHOP_RAYS : type === "r" ? ROOK_RAYS : QUEEN_RAYS;
  for (const [df, dr] of rays) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f <= 7 && r >= 1 && r <= 8) {
      const square = squareAt(f, r);
      out.push(square);
      if (square !== vacant && chess.get(square)) break;
      f += df;
      r += dr;
    }
  }
  return out;
}

/** How many pieces a quiet move to `to` would win, and the dearest of them. */
function winningTargets(chess: Chess, to: Square, type: string, color: Side, vacant: Square): { targets: number; value: number } {
  if (type === "k") return { targets: 0, value: 0 };
  const worth = VALUES[type];
  let targets = 0;
  let value = 0;
  for (const square of attackedSquares(chess, to, type, color, vacant)) {
    const piece = chess.get(square);
    if (!piece || piece.color === color || piece.type === "k" || VALUES[piece.type] < LOOM_NET) continue;
    // A piece their own side still defends is not won when it is no dearer than the attacker.
    if (VALUES[piece.type] <= worth && chess.isAttacked(square, piece.color)) continue;
    targets += 1;
    value = Math.max(value, VALUES[piece.type]);
    if (targets >= 2) return { targets, value };
  }
  return { targets, value };
}

/** Quiet replies that attack a piece, forks first. At most three, so the search stays short. */
function quietThreats(chess: Chess, san: string): string[] {
  chess.move(san);
  const found: { san: string; targets: number; value: number }[] = [];
  try {
    for (const reply of chess.moves({ verbose: true })) {
      if (reply.captured || reply.piece === "k" || reply.san.endsWith("+") || reply.san.endsWith("#")) continue;
      const hit = winningTargets(chess, reply.to, reply.piece, reply.color, reply.from);
      if (hit.targets > 0) found.push({ san: reply.san, ...hit });
    }
  } finally {
    chess.undo();
  }
  found.sort((a, b) => b.targets - a.targets || b.value - a.value);
  const forks = found.filter((threat) => threat.targets >= 2);
  const single = found.find((threat) => threat.targets === 1);
  return [...forks, ...(single ? [single] : [])].slice(0, 3).map((threat) => threat.san);
}

/**
 * Material still lost after answering `threat`, or null when the budget ran
 * out first. Meeting it means the loss falls below a minor piece.
 */
function answeredLoss(chess: Chess, threat: Move, net: number, budget: { left: number }): number | null {
  const attacked = new Set<Square>();
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== chess.turn() || piece.type === "k" || VALUES[piece.type] < LOOM_NET) continue;
      if (chess.attackers(piece.square, threat.color).includes(threat.to)) attacked.add(piece.square);
    }
  }
  const evasions = chess
    .moves({ verbose: true })
    .filter((move) => move.to === threat.to || attacked.has(move.from))
    .sort((a, b) => Number(b.to === threat.to) - Number(a.to === threat.to))
    .slice(0, LOOM_TRIES);
  let best = net;
  for (const evasion of evasions) {
    if (budget.left <= 0) return null;
    budget.left -= 1;
    chess.move(evasion);
    best = Math.min(best, passedLoss(chess));
    chess.undo();
    if (best < LOOM_NET) return best;
  }
  return best;
}

/**
 * A single attack the attacked piece can step off, without being the only
 * defender of something else. A fork, a pin, or a trapped piece still has to be priced.
 */
function stepsOff(chess: Chess, threat: Move): boolean {
  const cover = attackedSquares(chess, threat.to, threat.piece, threat.color, threat.from);
  const worth = VALUES[threat.piece];
  const victims: Square[] = [];
  for (const square of cover) {
    const piece = chess.get(square);
    if (!piece || piece.color === threat.color || piece.type === "k" || VALUES[piece.type] < LOOM_NET) continue;
    if (VALUES[piece.type] <= worth && chess.isAttacked(square, piece.color)) continue;
    victims.push(square);
    if (victims.length >= 2) return false;
  }
  const victim = victims[0];
  if (!victim) return true;
  const hit = new Set(cover);
  const flights = chess.moves({ square: victim, verbose: true });
  if (!flights.some((move) => move.to === threat.to || !hit.has(move.to))) return false;
  const guard = chess.get(victim)!;
  for (const square of attackedSquares(chess, victim, guard.type, guard.color, victim)) {
    const otherPiece = chess.get(square);
    if (!otherPiece || otherPiece.color !== guard.color || VALUES[otherPiece.type] < LOOM_NET) continue;
    const friends = chess.attackers(square, guard.color);
    if (friends.length === 1 && friends[0] === victim && chess.isAttacked(square, threat.color)) return false;
  }
  return true;
}

/** What `reply` still wins after the mover answers it. Null when the budget runs out first. */
function pricedThreat(chess: Chess, replySan: string, budget: { left: number }): number | null {
  const reply = chess.move(replySan);
  try {
    if (stepsOff(chess, reply)) return 0;
    if (budget.left <= 0) return null;
    budget.left -= 1;
    const net = passedLoss(chess);
    if (net < LOOM_NET) return 0;
    return answeredLoss(chess, reply, net, budget);
  } finally {
    chess.undo();
  }
}

/**
 * Marks a move that lets the opponent win a piece by a quiet move, when
 * another move at the same material does not. Only those tied moves are
 * searched. The expensive check runs on one threat per move, and an
 * unfinished look is not a loss.
 */
function loom(chess: Chess, rows: Assessed[]): void {
  if (rows.some((row) => row.mate || row.forcesMate)) return;
  const safe = rows.filter((row) => !row.allowsMate);
  if (safe.length === 0) return;
  const best = Math.max(...safe.map((row) => row.score));
  const pool = safe.filter((row) => row.score === best);
  if (pool.length < 2) return;
  const threats = pool.map((row) => ({ row, replies: quietThreats(chess, row.move.san) }));
  const budget = { left: LOOM_BUDGET };
  for (const { row, replies } of threats) {
    if (replies.length === 0) continue;
    chess.move(row.move.san);
    let extra = 0;
    for (const reply of replies) {
      const left = pricedThreat(chess, reply, budget);
      if (left === null) {
        chess.undo();
        return;
      }
      extra = Math.max(extra, left);
      if (extra >= LOOM_NET) break;
    }
    chess.undo();
    if (extra >= LOOM_NET) {
      row.loss += extra;
      row.score = row.gain - row.loss;
    }
  }
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
  const forkBudget = { left: 32 };
  const rows = chess.moves({ verbose: true }).map((m) => {
    chess.move(m.san);
    const mate = chess.isCheckmate();
    const draw = !mate && chess.isDraw();
    const replies = mate || draw ? [] : chess.moves();
    const allowsMate = replies.some((reply) => reply.endsWith("#"));
    const loss = checkingLoss(chess, replies, worstLoss(chess, replies), forkBudget);
    const flight = enemyKing ? replies.filter((reply) => reply.startsWith("K") || reply.startsWith("O-O")).length : 0;
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
  loom(chess, rows);
  return rows;
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
