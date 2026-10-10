import type { LegalMove } from "./rules";

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const SQUARE = /^[a-h][1-8]$/;

const FIGURINES: Record<string, string> = {
  "♔": "K", "♕": "Q", "♖": "R", "♗": "B", "♘": "N", "♙": "",
  "♚": "K", "♛": "Q", "♜": "R", "♝": "B", "♞": "N", "♟": "",
};
const PIECE_WORDS: Record<string, string> = {
  king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p",
};
/** Words that may sit between a piece's name and its destination. */
const LINKING_WORDS = new Set(["to", "on", "takes", "captures", "x"]);

// Check marks and the promotion "=" are optional in what models write.
const sanKey = (san: string): string => san.replace(/[+#=]/g, "");

/** Strips markdown, move numbers and punctuation from one word of a reply. */
function clean(word: string): string {
  return word
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^\d+\.+/, "")
    .replace(/[^A-Za-z0-9+#=]+$/, "")
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O");
}

function tokenize(raw: string): string[] {
  const letters = [...raw].map((ch) => FIGURINES[ch] ?? ch).join("");
  return letters.split(/[\s"'`:,;(){}[\]]+/).map(clean).filter(Boolean);
}

/** The piece a reply names in words just before `index`, e.g. "knight to" before "f3". */
function namedPiece(tokens: readonly string[], index: number): string | undefined {
  let i = index - 1;
  while (i >= 0 && LINKING_WORDS.has(tokens[i].toLowerCase())) i--;
  return i >= 0 ? PIECE_WORDS[tokens[i].toLowerCase()] : undefined;
}

function matchNotation(token: string, legal: readonly LegalMove[], ignoreCase: boolean): LegalMove | undefined {
  const long = token.toLowerCase().replace(/[-=]/g, "");
  if (UCI.test(long)) {
    const byUci = legal.find((m) => m.uci === long);
    if (byUci) return byUci;
  }
  const wanted = ignoreCase ? sanKey(token).toLowerCase() : sanKey(token);
  return legal.find((m) => (ignoreCase ? sanKey(m.san).toLowerCase() : sanKey(m.san)) === wanted);
}

function matchToken(
  tokens: readonly string[],
  index: number,
  legal: readonly LegalMove[],
  ignoreCase: boolean,
): LegalMove | undefined {
  const token = tokens[index];
  const piece = SQUARE.test(token.toLowerCase()) ? namedPiece(tokens, index) : undefined;
  if (piece) {
    // "knight to f3" means the knight, even though "f3" alone is a pawn move.
    const candidates = legal.filter((m) => m.piece === piece && m.to === token.toLowerCase());
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  return matchNotation(token, legal, ignoreCase);
}

function distinctMatches(tokens: readonly string[], legal: readonly LegalMove[], ignoreCase: boolean): LegalMove[] {
  const found = tokens.map((_, i) => matchToken(tokens, i, legal, ignoreCase)).filter((m): m is LegalMove => Boolean(m));
  return [...new Map(found.map((m) => [m.uci, m])).values()];
}

/**
 * Finds the one legal move a model's reply names. Returns null when the
 * reply names none, or names more than one.
 */
export function parseReply(raw: string, legal: readonly LegalMove[]): LegalMove | null {
  const tokens = tokenize(raw);
  const exact = distinctMatches(tokens, legal, false);
  const matches = exact.length > 0 ? exact : distinctMatches(tokens, legal, true);
  return matches.length === 1 ? matches[0] : null;
}
