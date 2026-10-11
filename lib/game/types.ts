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
  | "move_limit"
  | "provider_error"
  | "called_off";

/** A model at the board: which one, and how hard it thinks. */
export type Seat = { provider: Provider; model: string; modelLabel: string; effort: Effort | null };

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
  /** In an arena game, the model that plays the player's colour. Null when a person does. */
  rival: Seat | null;
  fen: string;
  ply: number;
  whiteMs: number;
  blackMs: number;
  turnStartedAt: number;
  aiLeaseUntil: number | null;
  /** What stopped the last call to a model that failed ("HTTP 429"). Null if none has. */
  aiError: string | null;
  status: Status;
  result: Result | null;
  reason: Reason | null;
  createdAt: number;
  /** Whether this game's result has been applied to the ratings. */
  rated: boolean;
  /** Both sides' ratings around this game. Null until rated, and for unrated games. */
  rating: RatingChange | null;
};

/** In an arena game, the "player" numbers are the rival model's. */
export type RatingChange = { playerBefore: number; playerAfter: number; aiBefore: number; aiAfter: number };

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
  /** In an arena game, the model on the player's side of the board. */
  rival: { label: string; effort: Effort | null } | null;
  /** What stopped the last call to a model that failed. Null if none has. */
  aiError: string | null;
  timeControl: string;
  fen: string;
  turn: Color;
  moves: Move[];
  whiteMs: number;
  blackMs: number;
  serverNow: number;
  createdAt: number;
  /** "bullet" or "regular": which ratings this game counts toward. */
  pool: "bullet" | "regular";
  rating: RatingChange | null;
};

export const opposite = (color: Color): Color => (color === "white" ? "black" : "white");
/** White moves on even plies (0, 2, ...). */
export const turnAt = (ply: number): Color => (ply % 2 === 0 ? "white" : "black");

/** The model that moves for `color`, or null when a person does. */
export const seatOf = (game: Game, color: Color): Seat | null => (color === game.playerColor ? game.rival : game);
