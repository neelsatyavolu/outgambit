import type { LegalMove } from "../chess/rules";
import type { Color, Effort } from "../game/types";

export type MoveRequest = {
  fen: string;
  /** SAN moves from the start of the game. */
  history: string[];
  legalMoves: LegalMove[];
  color: Color;
  remainingMs: number;
  model: string;
  effort?: Effort;
  /** The previous reply, when it was not a legal move. */
  rejected?: string;
  /** Aborts the call when the turn's time budget is spent. */
  signal: AbortSignal;
};

export type MoveResult = (
  | { kind: "move"; san: string }
  | { kind: "invalid"; raw: string }
  | { kind: "provider_error"; message: string }
) & {
  /** The input tokens the call was billed for, from providers that charge by them and say. */
  inputTokens?: number;
};

export type Adapter = (request: MoveRequest) => Promise<MoveResult>;
