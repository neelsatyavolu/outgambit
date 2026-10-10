import { parseReply } from "../chess/parse-reply";
import type { LegalMove } from "../chess/rules";
import type { MoveResult } from "./types";

const RAW_LIMIT = 200;

/** Turns a model's text into a move, or reports it as invalid. */
export function toResult(text: string, legal: readonly LegalMove[]): MoveResult {
  const move = parseReply(text, legal);
  return move ? { kind: "move", san: move.san } : { kind: "invalid", raw: text.trim().slice(0, RAW_LIMIT) };
}

// Provider responses can echo credentials or prompts, so only a short,
// fixed description of a failure ever leaves an adapter.
export const providerError = (message: string): MoveResult => ({ kind: "provider_error", message });

export const errorName = (error: unknown): string => (error instanceof Error ? error.name : "Error");
