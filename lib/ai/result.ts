import { parseReply } from "../chess/parse-reply";
import type { LegalMove } from "../chess/rules";
import type { MoveResult } from "./types";

const RAW_LIMIT = 200;

// Provider responses can echo credentials or prompts, so only a short,
// fixed description of a failure ever leaves an adapter.
export const providerError = (message: string): MoveResult => ({ kind: "provider_error", message });

/**
 * Turns a model's text into a move, or reports it as invalid. A reply with
 * no text at all is the provider failing, not the model choosing badly.
 */
export function toResult(text: string, legal: readonly LegalMove[]): MoveResult {
  if (text.trim() === "") return providerError("empty reply");
  const move = parseReply(text, legal);
  return move ? { kind: "move", san: move.san } : { kind: "invalid", raw: text.trim().slice(0, RAW_LIMIT) };
}


export const errorName = (error: unknown): string => (error instanceof Error ? error.name : "Error");
