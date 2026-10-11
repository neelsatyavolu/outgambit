import { Chess, type Color as Side, type Move, type PieceSymbol, type Square } from "chess.js";
import { PIECE_NAMES } from "./describe";
import { VALUES } from "./tactics";

/**
 * What each move does, in words. A model that picks from a list without
 * calculating reads these the way a player reads the board: it still chooses,
 * but it is told that a move forks two pieces or pushes a passed pawn rather
 * than left to see it. Nothing here ranks or removes a move.
 */
export type Phase = "opening" | "middlegame" | "endgame";

export type Survey = {
  phase: Phase;
  /** How far ahead the side to move is in material, in pawns. Negative when behind. */
  lead: number;
  /** The most telling things about each move, by UCI. */
  notes: Map<string, string[]>;
};

/** The notes that advice is written about, so the advice can be left out when no option carries them. */
export const NOTE = {
  draws: "draws the game at once",
  repeats: "repeats an earlier position",
  trade: "an even trade",
  boxes: "leaves the enemy king fewer squares",
} as const;

/** A side this far ahead in material, a knight or more, should be finishing the game. */
export const WINNING_LEAD = 3;

/** What is true of the position before any move is tried. */
type Scene = {
  phase: Phase;
  ply: number;
  /** The positions the game has already been through. */
  seen: ReadonlySet<string>;
  /** Whether the side to move is far enough ahead that its job is to finish the game. */
  winning: boolean;
  /** Where the enemy king stands, and how many squares it could step to now. Null where that cannot be worked out. */
  enemyKing: { square: Square; room: number | null } | null;
};

const OPENING_PLIES = 20;
const EARLY_QUEEN_PLIES = 12;
/** A side with no more than this in pieces, pawns aside, is in an endgame: a queen and a minor piece, or two rooks and one. */
const ENDGAME_PIECES = 13;
const MOST_NOTES = 2;
const CENTRE = new Set(["d4", "e4", "d5", "e5"]);

const other = (side: Side): Side => (side === "w" ? "b" : "w");
const fileOf = (square: string): number => square.charCodeAt(0) - 97;
const rankOf = (square: string): number => Number(square[1]);
/** A square's rank as its own side counts it: 1 is home, 7 is one step from promoting. */
const rankFor = (square: string, side: Side): number => (side === "w" ? rankOf(square) : 9 - rankOf(square));

type Placed = { square: Square; type: PieceSymbol; color: Side };

const pieces = (chess: Chess): Placed[] => chess.board().flatMap((row) => row.filter((p) => p !== null));

/** One side's material: everything, and the pieces alone. */
function material(chess: Chess, side: Side): { all: number; pieces: number } {
  const own = pieces(chess).filter((p) => p.color === side);
  const sum = (list: Placed[]) => list.reduce((total, p) => total + VALUES[p.type], 0);
  return { all: sum(own), pieces: sum(own.filter((p) => p.type !== "p")) };
}

function phaseOf(chess: Chess, ply: number): Phase {
  if (Math.max(material(chess, "w").pieces, material(chess, "b").pieces) <= ENDGAME_PIECES) return "endgame";
  return ply < OPENING_PLIES ? "opening" : "middlegame";
}

/** Whether a pawn has no enemy pawn ahead of it, on its own file or the ones beside it. */
function isPassed(chess: Chess, square: string, side: Side): boolean {
  return !pieces(chess).some(
    (p) =>
      p.type === "p" &&
      p.color !== side &&
      Math.abs(fileOf(p.square) - fileOf(square)) <= 1 &&
      rankFor(p.square, side) > rankFor(square, side),
  );
}

const isOpenFile = (chess: Chess, file: number): boolean =>
  !pieces(chess).some((p) => p.type === "p" && fileOf(p.square) === file);

/** How many king steps apart two squares are. */
const kingSteps = (a: string, b: string): number => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));

/** How many king steps a square is from the four in the middle. */
function centreDistance(square: string): number {
  const off = (index: number) => (index <= 3 ? 3 - index : index - 4);
  return Math.max(off(fileOf(square)), off(rankOf(square) - 1));
}

/** What makes two positions the same for repetition: the pieces, whose move it is, and the castling and en passant rights. */
const positionKey = (chess: Chess): string => chess.fen().split(" ").slice(0, 4).join(" ");

/** The same position with `side` to move again, for seeing what it could do next. Null when that cannot be set up. */
function movingAgain(chess: Chess, side: Side): Chess | null {
  const fen = chess.fen().split(" ");
  try {
    return new Chess([fen[0], side, fen[2], "-", fen[4], fen[5]].join(" "));
  } catch {
    // Not a position chess.js will set up, such as one where the other king is in check.
    return null;
  }
}

/**
 * The enemy pieces the piece that just moved now attacks and stands to win:
 * worth more than it, or defended by nothing. Most valuable first.
 */
function targets(chess: Chess, move: Move): Array<Placed & { dearer: boolean }> {
  const attacker = move.promotion ?? move.piece;
  // A king cannot take a defended piece, whatever it is worth.
  const worth = attacker === "k" ? Number.POSITIVE_INFINITY : VALUES[attacker];
  return pieces(chess)
    .filter((p) => p.color !== move.color && p.type !== "k" && chess.attackers(p.square, move.color).includes(move.to))
    .map((p) => ({ ...p, dearer: VALUES[p.type] > worth, loose: chess.attackers(p.square, p.color).length === 0 }))
    .filter((p) => p.dearer || (p.loose && VALUES[p.type] >= VALUES.n))
    .sort((a, b) => VALUES[b.type] - VALUES[a.type]);
}

function threatNote(chess: Chess, move: Move, check: boolean): string | null {
  const hit = targets(chess, move);
  const named = [...(check ? ["the king"] : []), ...hit.map((p) => `the ${PIECE_NAMES[p.type]}`)];
  if (named.length >= 2) return `forks ${named[0]} and ${named[1]}`;
  if (hit.length === 0) return null;
  // A piece worth more is a target defended or not; a lesser one only because nothing guards it.
  return hit[0].dearer ? `attacks the ${PIECE_NAMES[hit[0].type]}` : `attacks the undefended ${PIECE_NAMES[hit[0].type]}`;
}

/** Whether the pawn on `from` is part of the cover in front of its own castled king. */
function shieldsKing(chess: Chess, from: string, side: Side): boolean {
  const king = pieces(chess).find((p) => p.type === "k" && p.color === side);
  if (!king || rankFor(king.square, side) !== 1 || rankFor(from, side) !== 2) return false;
  const file = fileOf(king.square);
  // A king on the d- or e-file has not castled, so the pawns near it are centre pawns, not cover.
  return (file <= 2 || file >= 6) && Math.abs(fileOf(from) - file) <= 1;
}

/**
 * Whether a piece has more squares to go to after the move, or fewer. Two is
 * the least difference worth telling a model about.
 */
function activityNote(next: Chess | null, move: Move, before: number): string | null {
  if (!next || move.piece === "p" || move.piece === "k") return null;
  const change = next.moves({ square: move.to }).length - before;
  if (Math.abs(change) < 2) return null;
  return `makes the ${PIECE_NAMES[move.piece]} ${change > 0 ? "more" : "less"} active`;
}

/** What the move does for where its piece now stands, going by the kind of piece. */
function placementNote(chess: Chess, move: Move, scene: Scene): string | null {
  const { phase, ply } = scene;
  const side = move.color;
  const home = rankFor(move.from, side) === 1;
  if (move.piece === "p") {
    if (phase !== "opening" && !move.promotion && isPassed(chess, move.to, side)) {
      return rankFor(move.to, side) === 7 ? "pushes a passed pawn to one step from promoting" : "advances a passed pawn";
    }
    if (phase === "endgame") return null;
    if (CENTRE.has(move.to)) return "claims the centre";
    return shieldsKing(chess, move.from, side) ? "loosens the pawns in front of the king" : null;
  }
  if (move.piece === "r") {
    if (rankFor(move.to, side) === 7 && rankFor(move.from, side) !== 7) return "puts the rook on the seventh rank";
    const file = fileOf(move.to);
    return file !== fileOf(move.from) && isOpenFile(chess, file) ? "puts the rook on an open file" : null;
  }
  if (move.piece === "k") {
    if (phase !== "endgame") return home && fileOf(move.from) === 4 ? "moves the king off its home square" : null;
    // A side that is winning needs its king beside the other one to mate it; otherwise the middle is the place to be.
    const enemy = scene.winning ? scene.enemyKing?.square : undefined;
    if (enemy && kingSteps(move.to, enemy) < kingSteps(move.from, enemy)) return "brings the king closer to the enemy king";
    return centreDistance(move.to) < centreDistance(move.from) ? "brings the king toward the centre" : null;
  }
  if (move.piece === "q") return ply < EARLY_QUEEN_PLIES ? "brings the queen out early" : null;
  if (move.piece === "n" && !move.captured && (fileOf(move.to) === 0 || fileOf(move.to) === 7)) {
    return "puts the knight on the edge of the board";
  }
  if (ply >= OPENING_PLIES) return null;
  if (home) return "develops a piece";
  return move.captured ? null : "moves a piece that is already developed";
}

/** Whether the move leaves the enemy king fewer squares to step to than it has now. Only a side that is winning is told. */
function boxesIn(chess: Chess, scene: Scene): boolean {
  const king = scene.enemyKing;
  if (!scene.winning || !king || king.room === null) return false;
  return chess.moves({ square: king.square }).length < king.room;
}

/**
 * Everything worth saying about one move, most telling first. `before` is how
 * many moves its piece has now. Leaves the board as it found it.
 */
function notesFor(chess: Chess, move: Move, before: number, scene: Scene): string[] {
  chess.move(move.san);
  const check = chess.inCheck();
  const draws = chess.isDraw();
  const castles = move.san.startsWith("O-O");
  const next = check ? null : movingAgain(chess, move.color);
  const trade =
    move.captured !== undefined &&
    VALUES[move.captured] === VALUES[move.piece] &&
    chess.attackers(move.to, other(move.color)).length > 0;
  const placement = castles ? "makes the king safe" : placementNote(chess, move, scene);
  const found = [
    draws ? NOTE.draws : null,
    next?.moves().some((san) => san.endsWith("#")) ? "threatens checkmate next move" : null,
    !draws && scene.seen.has(positionKey(chess)) ? NOTE.repeats : null,
    castles ? null : threatNote(chess, move, check),
    trade ? NOTE.trade : null,
    boxesIn(chess, scene) ? NOTE.boxes : null,
    // A move already described by where its piece lands is not also described by how free it is there.
    placement ?? activityNote(next, move, before),
  ];
  chess.undo();
  return found.filter((note) => note !== null).slice(0, MOST_NOTES);
}

function surveyBoard(chess: Chess, ply: number, seen: ReadonlySet<string>, only?: readonly string[]): Survey {
  const side = chess.turn();
  const lead = material(chess, side).all - material(chess, other(side)).all;
  const king = pieces(chess).find((p) => p.type === "k" && p.color !== side);
  const scene: Scene = {
    phase: phaseOf(chess, ply),
    ply,
    seen,
    winning: lead >= WINNING_LEAD,
    enemyKing: king ? { square: king.square, room: movingAgain(chess, king.color)?.moves({ square: king.square }).length ?? null } : null,
  };
  const legal = chess.moves({ verbose: true });
  const movesFrom = (square: string): number => legal.filter((m) => m.from === square).length;
  return {
    phase: scene.phase,
    lead,
    notes: new Map(legal.filter((m) => !only || only.includes(m.lan)).map((m) => [m.lan, notesFor(chess, m, movesFrom(m.from), scene)])),
  };
}

/** Surveys the position reached by `history`, noting every legal move or only those in `only` (UCI). */
export function survey(history: readonly string[], only?: readonly string[]): Survey {
  const chess = new Chess();
  const seen = new Set([positionKey(chess)]);
  for (const san of history) {
    chess.move(san);
    seen.add(positionKey(chess));
  }
  return surveyBoard(chess, history.length, seen, only);
}

/** The same for a position given as a FEN, `ply` half-moves into its game. */
export function surveyPosition(fen: string, ply: number, only?: readonly string[]): Survey {
  return surveyBoard(new Chess(fen), ply, new Set(), only);
}
