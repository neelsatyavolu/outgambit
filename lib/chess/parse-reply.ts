import type { LegalMove } from "./rules";

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

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

function matchToken(token: string, legal: readonly LegalMove[], ignoreCase: boolean): LegalMove | undefined {
  const long = token.toLowerCase().replace("-", "");
  if (UCI.test(long)) {
    const byUci = legal.find((m) => m.uci === long);
    if (byUci) return byUci;
  }
  const wanted = ignoreCase ? sanKey(token).toLowerCase() : sanKey(token);
  return legal.find((m) => (ignoreCase ? sanKey(m.san).toLowerCase() : sanKey(m.san)) === wanted);
}

function distinctMatches(tokens: readonly string[], legal: readonly LegalMove[], ignoreCase: boolean): LegalMove[] {
  const found = tokens.map((t) => matchToken(t, legal, ignoreCase)).filter((m): m is LegalMove => Boolean(m));
  return [...new Map(found.map((m) => [m.uci, m])).values()];
}

/**
 * Finds the one legal move a model's reply names. Returns null when the
 * reply names none, or names more than one.
 */
export function parseReply(raw: string, legal: readonly LegalMove[]): LegalMove | null {
  const tokens = raw.split(/\s+/).map(clean).filter(Boolean);
  const exact = distinctMatches(tokens, legal, false);
  const matches = exact.length > 0 ? exact : distinctMatches(tokens, legal, true);
  return matches.length === 1 ? matches[0] : null;
}
