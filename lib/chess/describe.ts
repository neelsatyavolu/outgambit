import type { LegalMove } from "./rules";

export const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Draws a FEN as eight labelled ranks, white at the bottom. */
export function textBoard(fen: string): string {
  const ranks = fen.split(" ")[0].split("/");
  const rows = ranks.map((rank, i) => {
    const squares = [...rank].flatMap((ch) => (/\d/.test(ch) ? Array<string>(Number(ch)).fill(".") : [ch]));
    return `${8 - i} ${squares.join(" ")}`;
  });
  return [...rows, "  a b c d e f g h"].join("\n");
}

/** One plain-language line per move, for models that do not read notation. */
export function describeMove(move: LegalMove): string {
  if (move.san.startsWith("O-O-O")) return withEnding("Castles queenside", move);
  if (move.san.startsWith("O-O")) return withEnding("Castles kingside", move);
  const parts = [
    `${capitalize(PIECE_NAMES[move.piece])} from ${move.from} to ${move.to}`,
    ...(move.captured ? [`captures ${PIECE_NAMES[move.captured]}`] : []),
    ...(move.promotion ? [`promotes to ${PIECE_NAMES[move.promotion]}`] : []),
  ];
  return withEnding(parts.join(", "), move);
}

function withEnding(text: string, move: LegalMove): string {
  if (move.mate) return `${text}, checkmate`;
  if (move.check) return `${text}, gives check`;
  return text;
}
