export const PROVIDERS = ["codex", "grok", "gemini", "openrouter", "jev", "openai", "gateway", "fake"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];
export type Color = "white" | "black";
export type Status = "active" | "finished" | "aborted";
export type Result = "white" | "black" | "draw";
export type Reason =
  | "checkmate"
  | "stalemate"
  | "repetition"
  | "fifty_move"
  | "insufficient_material"
  | "timeout"
  | "resignation"
  | "illegal_move"
  | "provider_error";

export type Game = {
  id: string;
  playerId: string;
  ipHash: string;
  day: string;
  provider: Provider;
  model: string;
  modelLabel: string;
  effort: Effort | null;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
  playerColor: Color;
  fen: string;
  ply: number;
  whiteMs: number;
  blackMs: number;
  turnStartedAt: number;
  aiLeaseUntil: number | null;
  status: Status;
  result: Result | null;
  reason: Reason | null;
  createdAt: number;
};

export type Move = { ply: number; san: string; uci: string; fenAfter: string; spentMs: number };

/** What a browser is allowed to see about a game. */
export type GameView = {
  id: string;
  status: Status;
  result: Result | null;
  reason: Reason | null;
  playerColor: Color;
  provider: Provider;
  modelLabel: string;
  effort: Effort | null;
  timeControl: string;
  fen: string;
  turn: Color;
  moves: Move[];
  whiteMs: number;
  blackMs: number;
  serverNow: number;
  createdAt: number;
};

export const opposite = (color: Color): Color => (color === "white" ? "black" : "white");
/** White moves on even plies (0, 2, ...). */
export const turnAt = (ply: number): Color => (ply % 2 === 0 ? "white" : "black");
