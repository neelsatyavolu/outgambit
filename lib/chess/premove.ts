import { Chess, type PieceSymbol } from "chess.js";

export type Piece = { color: "w" | "b"; type: PieceSymbol };
/** Which piece stands on each occupied square. */
export type Placement = Readonly<Record<string, Piece>>;

const FILES = "abcdefgh";
const SQUARES = [...FILES].flatMap((file) => [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => `${file}${rank}`));
const coords = (square: string) => ({ file: FILES.indexOf(square[0]), rank: Number(square[1]) - 1 });

export function placementOf(fen: string): Placement {
  const pieces = new Chess(fen).board().flat();
  return Object.fromEntries(pieces.flatMap((p) => (p ? [[p.square, { color: p.color, type: p.type }]] : [])));
}

/** Whether the king on `from` could castle to `to`: the right is still held, and king and rook are at home. */
function castles(placement: Placement, king: Piece, from: string, to: string, castling: string): boolean {
  const rank = king.color === "w" ? "1" : "8";
  if (from !== `e${rank}`) return false;
  const side = to === `g${rank}` ? "k" : to === `c${rank}` ? "q" : null;
  if (!side) return false;
  const rook = placement[`${side === "k" ? "h" : "a"}${rank}`];
  const right = king.color === "w" ? side.toUpperCase() : side;
  return castling.includes(right) && rook?.type === "r" && rook.color === king.color;
}

/** Whether the piece moves that way at all, whatever stands between or on the squares. */
function reaches(placement: Placement, piece: Piece, from: string, to: string, castling: string): boolean {
  const a = coords(from);
  const b = coords(to);
  const dx = Math.abs(b.file - a.file);
  const dy = b.rank - a.rank;
  const ady = Math.abs(dy);
  switch (piece.type) {
    case "p": {
      const forward = piece.color === "w" ? 1 : -1;
      if (dy === forward) return dx <= 1;
      return dx === 0 && dy === 2 * forward && a.rank === (piece.color === "w" ? 1 : 6);
    }
    case "n":
      return (dx === 1 && ady === 2) || (dx === 2 && ady === 1);
    case "b":
      return dx === ady;
    case "r":
      return dx === 0 || ady === 0;
    case "q":
      return dx === ady || dx === 0 || ady === 0;
    case "k":
      return (dx <= 1 && ady <= 1) || castles(placement, piece, from, to, castling);
  }
}

/**
 * Where the piece on `from` may be premoved. The board will have changed by the
 * time the move is played, so this is the piece's pattern of movement alone:
 * blockers may have gone, and a square the mover holds now may hold an enemy then.
 * `castling` is the castling field of the FEN.
 */
export function premoveTargets(placement: Placement, from: string, castling: string): string[] {
  const piece = placement[from];
  if (!piece) return [];
  return SQUARES.filter((to) => to !== from && reaches(placement, piece, from, to, castling));
}

function applyPremove(placement: Placement, uci: string): Placement {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const piece = placement[from];
  if (!piece) return placement;
  const rank = from[1];
  const castled = piece.type === "k" && Math.abs(coords(to).file - coords(from).file) === 2;
  const rookFrom = castled ? `${to[0] === "g" ? "h" : "a"}${rank}` : null;
  const rook = rookFrom ? placement[rookFrom] : undefined;
  const rest = Object.entries(placement).filter(([square]) => square !== from && square !== (rook ? rookFrom : null));
  return Object.fromEntries([
    ...rest,
    [to, uci[4] ? { color: piece.color, type: uci[4] as PieceSymbol } : piece],
    ...(rook ? [[`${to[0] === "g" ? "f" : "d"}${rank}`, rook] as const] : []),
  ]);
}

/** The position to draw while premoves are queued: each one shown as if already played. */
export function withPremoves(fen: string, premoves: readonly string[]): Placement {
  return premoves.reduce(applyPremove, placementOf(fen));
}

/** The premove from→to as a move. A pawn reaching the last rank becomes a queen. */
export function premoveUci(placement: Placement, from: string, to: string): string {
  const piece = placement[from];
  const promotes = piece?.type === "p" && to[1] === (piece.color === "w" ? "8" : "1");
  return `${from}${to}${promotes ? "q" : ""}`;
}

/** Whether the move can be played in the position, which a premove has to wait to find out. */
export function isLegalMove(fen: string, uci: string): boolean {
  try {
    new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return true;
  } catch {
    return false;
  }
}
