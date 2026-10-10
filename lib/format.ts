import type { GameView, Provider, Reason } from "./game/types";

export const PROVIDER_LABELS: Record<Provider, string> = {
  codex: "ChatGPT",
  grok: "Grok",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  jev: "TypeSafe",
  openai: "OpenAI Decisions",
  gateway: "Vercel AI Gateway",
  fake: "Test",
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** A clock face: "10:00", "1:02:05", and tenths once under ten seconds. */
export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) {
    const tenths = Math.floor(safe / 100);
    return `0:${pad(Math.floor(tenths / 10))}.${tenths % 10}`;
  }
  const seconds = Math.ceil(safe / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
}

const REASON_LABELS: Record<Reason, string> = {
  checkmate: "checkmate",
  stalemate: "stalemate",
  repetition: "repetition",
  fifty_move: "fifty-move rule",
  insufficient_material: "insufficient material",
  timeout: "time",
  resignation: "resignation",
  illegal_move: "illegal move",
  provider_error: "AI unavailable",
};

export const reasonText = (reason: Reason): string => REASON_LABELS[reason];

/** A player's own game in a few words: "won · checkmate", "live". */
export function outcomeText(game: Pick<GameView, "status" | "result" | "reason" | "playerColor">): string {
  if (game.status === "active") return "live";
  if (game.status === "aborted" || !game.result || !game.reason) return "aborted";
  const verdict = game.result === "draw" ? "draw" : game.result === game.playerColor ? "won" : "lost";
  return `${verdict} · ${reasonText(game.reason)}`;
}

type Finished = Pick<GameView, "status" | "result" | "reason" | "playerColor" | "modelLabel">;

function detailFor(game: Finished, spectator: boolean): string {
  const player = spectator ? "The player" : "You";
  const playerLost = game.result !== null && game.result !== "draw" && game.result !== game.playerColor;
  switch (game.reason) {
    case "checkmate":
      return "Checkmate.";
    case "stalemate":
      return "Stalemate.";
    case "repetition":
      return "The same position occurred three times.";
    case "fifty_move":
      return "Fifty moves passed without a capture or a pawn move.";
    case "insufficient_material":
      return "Neither side has enough material to checkmate.";
    case "timeout":
      return `${playerLost ? player : game.modelLabel} ran out of time.`;
    case "resignation":
      return `${player} resigned.`;
    case "illegal_move":
      return `${game.modelLabel} could not produce a legal move and forfeited.`;
    case "provider_error":
      return spectator
        ? `${game.modelLabel} is unavailable. The game does not count toward the daily limits.`
        : `${game.modelLabel} is unavailable. This game does not count toward your daily limit.`;
    default:
      return "";
  }
}

function titleFor(game: Finished, spectator: boolean): string {
  if (game.status === "aborted") return "Game aborted";
  if (game.result === "draw" || game.result === null) return "Draw";
  const playerWon = game.result === game.playerColor;
  if (spectator) return playerWon ? "The player won" : `${game.modelLabel} won`;
  return playerWon ? "You won" : "You lost";
}

/** The end-of-game message, or null while the game is still going. */
export function headline(game: Finished, spectator: boolean): { title: string; detail: string } | null {
  if (game.status === "active") return null;
  return { title: titleFor(game, spectator), detail: detailFor(game, spectator) };
}

const STARTING_COUNT: ReadonlyArray<[piece: string, count: number]> = [
  ["q", 1], ["r", 2], ["b", 2], ["n", 2], ["p", 8],
];

function lost(placement: string, white: boolean): string[] {
  return STARTING_COUNT.flatMap(([piece, count]) => {
    const symbol = white ? piece.toUpperCase() : piece;
    const present = [...placement].filter((ch) => ch === symbol).length;
    return Array<string>(Math.max(0, count - present)).fill(piece);
  });
}

/** The pieces each side has lost, most valuable first. */
export function capturedPieces(fen: string): { white: string[]; black: string[] } {
  const placement = fen.split(" ")[0];
  return { white: lost(placement, true), black: lost(placement, false) };
}
