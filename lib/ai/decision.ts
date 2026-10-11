import { describeMove, textBoard } from "../chess/describe";
import type { LegalMove } from "../chess/rules";
import { assessMoves, shortlist } from "../chess/tactics";
import { numberedMoves } from "./prompt";
import { errorName, providerError } from "./result";
import type { Adapter, MoveRequest } from "./types";

/**
 * Decision models (Jev, OpenAI Decisions, the ones on Vercel AI Gateway)
 * do not write a move: they pick one option from a list, in a fraction of a
 * second. They also cannot calculate. So code does the calculating first
 * (checkmate in one, pieces left hanging, free captures) and the model
 * chooses among the moves that survive. This file is that shared method;
 * each provider only supplies how to send the question.
 */
export type DecisionOption = { key: string; description: string };

export type DecisionState = { side_to_move: string; board: string; position_fen: string; moves_so_far: string };

export type DecisionQuery = {
  model: string;
  state: DecisionState;
  instructions: { question: string; guidance: string };
  /** The same options in two different orders, to be asked as two questions. */
  orderings: [DecisionOption[], DecisionOption[]];
  signal: AbortSignal;
};

export type DecisionAnswer = { choice: string | null; probabilities: Record<string, number> };

/**
 * Sends one query. Resolves to one answer per ordering and the input tokens
 * it was billed for, or a short description of the failure.
 */
export type Decider = (query: DecisionQuery) => Promise<{ answers: DecisionAnswer[]; inputTokens?: number } | { error: string }>;

/** More input tokens than one question about one position could take: a count above this is a mistake, not a bill. */
const MOST_TOKENS = 1_000_000;

/** The input tokens a decision response says it used, as a whole number. Undefined if it does not say, or says nonsense. */
export function billedTokens(usage: unknown): number | undefined {
  const tokens = (usage as { input_tokens?: unknown } | null | undefined)?.input_tokens;
  return typeof tokens === "number" && tokens >= 0 && tokens <= MOST_TOKENS ? Math.round(tokens) : undefined;
}

export type DecisionOptions = {
  rng?: () => number;
  /** Off only for measuring how a model plays on its own. */
  assist?: boolean;
};

const CENTRE = new Set(["d4", "e4", "d5", "e5"]);
const OPENING_PLIES = 20;
const EARLY_QUEEN_PLIES = 12;

export const INSTRUCTIONS = {
  question: "Which option is the best chess move for `side_to_move` in the position shown in `board`?",
  guidance:
    "In the opening, develop knights and bishops, claim the centre with pawns, castle early, and do not bring the " +
    "queen out early or move the king. Later, prefer moves that give check, capture, create threats, or bring a " +
    "piece to a more active square. Every option is already safe from losing material at once.",
};

/** The state as plain text, for providers that take a string. */
export function stateText(state: DecisionState): string {
  return [
    `Side to move: ${state.side_to_move}`,
    `Moves so far: ${state.moves_so_far}`,
    `Position (FEN): ${state.position_fen}`,
    "Board (white at the bottom, capitals are white):",
    state.board,
  ].join("\n");
}

/** The question as one plain sentence block, for providers that take a string. */
export const instructionsText = (instructions: DecisionQuery["instructions"]): string =>
  `${instructions.question.replaceAll("`", "")} ${instructions.guidance}`;

/** Fisher-Yates on a copy. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// These models read descriptions literally and do not work things out from
// the board, so what a move does for the position is stated in the option.
function positionalNote(move: LegalMove, color: MoveRequest["color"], ply: number): string | null {
  const homeRank = color === "white" ? "1" : "8";
  if ((move.piece === "n" || move.piece === "b") && move.from[1] === homeRank && ply < OPENING_PLIES) {
    return "develops a piece";
  }
  if (move.piece === "p" && CENTRE.has(move.to)) return "claims the centre";
  if (move.piece === "q" && ply < EARLY_QUEEN_PLIES) return "brings the queen out early";
  if (move.piece === "k" && !move.san.startsWith("O-O") && move.from === `e${homeRank}`) {
    return "moves the king off its home square";
  }
  return null;
}

function option(move: LegalMove, request: MoveRequest): DecisionOption {
  const note = positionalNote(move, request.color, request.history.length);
  return { key: move.uci, description: note ? `${describeMove(move)}, ${note}` : describeMove(move) };
}

/** The option with the most combined support, or the stated choice when no probabilities came back. */
function strongest(answers: readonly DecisionAnswer[]): string | null {
  const totals = new Map<string, number>();
  for (const answer of answers) {
    for (const [key, p] of Object.entries(answer.probabilities)) totals.set(key, (totals.get(key) ?? 0) + p);
  }
  const best = [...totals.entries()].reduce<[string, number] | null>((top, e) => (top && top[1] >= e[1] ? top : e), null);
  if (best && best[1] > 0) return best[0];
  return answers.find((a) => a.choice !== null)?.choice ?? null;
}

// These models lean toward the first option listed, so the same question is
// asked twice in one request with the options in opposite orders, and the
// two sets of probabilities are added together.
function buildQuery(request: MoveRequest, moves: readonly LegalMove[], rng: () => number): DecisionQuery {
  const first = shuffled(moves, rng).map((m) => option(m, request));
  return {
    model: request.model,
    state: {
      side_to_move: request.color,
      board: textBoard(request.fen),
      position_fen: request.fen,
      moves_so_far: numberedMoves(request.history),
    },
    instructions: INSTRUCTIONS,
    orderings: [first, [...first].reverse()],
    signal: request.signal,
  };
}

/** An opponent that plays by asking a decision model to choose among sound moves. */
export function decisionAdapter(decide: Decider, options: DecisionOptions = {}): Adapter {
  const rng = options.rng ?? Math.random;
  return async (request) => {
    const moves = options.assist === false ? request.legalMoves : shortlist(assessMoves(request.history)).map((a) => a.move);
    // With one sound move there is nothing to ask.
    if (options.assist !== false && moves.length === 1) return { kind: "move", san: moves[0].san };
    try {
      const outcome = await decide(buildQuery(request, moves, rng));
      if ("error" in outcome) return providerError(outcome.error);
      const { inputTokens } = outcome;
      const chosen = strongest(outcome.answers);
      if (chosen === null) return { ...providerError("bad response"), inputTokens };
      const move = moves.find((m) => m.uci === chosen);
      return move ? { kind: "move", san: move.san, inputTokens } : { kind: "invalid", raw: chosen, inputTokens };
    } catch (error) {
      return providerError(errorName(error));
    }
  };
}

/** Reads a `{ key: probability }` object, ignoring anything that is not a number. */
export function probabilityMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}
