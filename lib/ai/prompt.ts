import type { MoveRequest } from "./types";

/** "1. e4 e5 2. Nf3" */
export function numberedMoves(history: readonly string[]): string {
  if (history.length === 0) return "none";
  return history.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(" ");
}

function clockText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function buildPrompt(request: MoveRequest): { system: string; user: string } {
  const system = [
    `You are playing a game of chess as ${request.color}.`,
    "Reply with exactly one move, chosen from the list of legal moves and written exactly as it appears there.",
    "Reply with the move only: no explanation and no other text.",
  ].join(" ");
  const lines = [
    `You are ${request.color} and it is your move.`,
    `Position (FEN): ${request.fen}`,
    `Moves so far: ${numberedMoves(request.history)}`,
    `Legal moves: ${request.legalMoves.map((m) => m.san).join(", ")}`,
    `Time left on your clock: ${clockText(request.remainingMs)}`,
    ...(request.rejected === undefined
      ? []
      : [`Your previous reply "${request.rejected}" is not a legal move. Choose a move from the list.`]),
  ];
  return { system, user: lines.join("\n") };
}
