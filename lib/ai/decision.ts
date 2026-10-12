import { describeMove, textBoard } from "../chess/describe";
import type { LegalMove } from "../chess/rules";
import { focusMoves, NOTE, WINNING_LEAD, survey, type Phase, type Survey } from "../chess/notes";
import { assessMoves, shortlist } from "../chess/tactics";
import { numberedMoves } from "./prompt";
import { errorName, providerError } from "./result";
import type { Adapter, MoveRequest } from "./types";

/**
 * Decision models (Jev, Mercury Decide, SubQ Snap, OpenAI Decisions, the ones on Vercel AI Gateway)
 * do not write a move: they pick one option from a list, in a fraction of a
 * second. They also cannot calculate. So code does the calculating first
 * (a checkmate it can force within three moves, pieces left hanging, a
 * draw, a king hunt, a mate or a fork the move prepares)
 * and the model chooses among the moves that survive. The list is kept
 * short, which is both faster and less repetitive. This file is that shared
 * method;
 * each provider only supplies how to send the question.
 */
export type DecisionOption = { key: string; description: string };

export type DecisionState = {
  side_to_move: string;
  phase: string;
  /** Who is ahead in material and by how much, or "level". */
  material: string;
  board: string;
  position_fen: string;
  last_moves: string;
};

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

/**
 * The input tokens a decision response says it used, as a whole number. Undefined if it does not say, or says
 * nonsense. TypeSafe and OpenAI spell the count `input_tokens`; AI Gateway spells it `inputTokens`.
 */
export function billedTokens(usage: unknown): number | undefined {
  const said = usage as { input_tokens?: unknown; inputTokens?: unknown } | null | undefined;
  const tokens = said?.input_tokens ?? said?.inputTokens;
  return typeof tokens === "number" && tokens >= 0 && tokens <= MOST_TOKENS ? Math.round(tokens) : undefined;
}

export type DecisionOptions = {
  rng?: () => number;
  /** Off only for measuring how a model plays on its own. */
  assist?: boolean;
  /** Off only for measuring what telling the model about each move adds. */
  notes?: boolean;
};

const QUESTION = "Which option is the best chess move for `side_to_move` in the position shown in `board`?";
const SAFE = "Every option is already safe from losing material at once.";

/** The one piece of advice for every position, for when the options say nothing about what they do. */
export const INSTRUCTIONS = {
  question: QUESTION,
  guidance:
    "In the opening, develop knights and bishops, claim the centre with pawns, castle early, and do not bring the " +
    `queen out early or move the king. Later, prefer moves that give check, capture, create threats, or bring a piece to a more active square. ${SAFE}`,
};

const TACTICS = "Prefer an option that threatens checkmate, forks two pieces, or attacks a piece.";
const PLANS = "Prefer an option that sets up a threat for the next move.";
const ADVICE: Record<Phase, string> = {
  opening:
    "This is the opening: otherwise develop knights and bishops, claim the centre with pawns and castle early. Do " +
    "not bring the queen out early, move the king, or move a piece that is already developed.",
  middlegame:
    "This is the middlegame: otherwise give check or capture, or bring a piece to a more active square, such as a " +
    "rook to an open file. Keep the king safe.",
  endgame:
    "This is the endgame: otherwise advance passed pawns toward promotion, bring the king toward the centre, and " +
    "put a rook on an open file or the seventh rank.",
};
const WINNING =
  "Your side is winning, so finish the game: leave the enemy king fewer squares, bring your king closer to it, and " +
  "promote a pawn if you can.";
const DRAWS = "Pick an option that draws the game at once only if your side is behind.";
const REPEATS = "Avoid an option that repeats an earlier position unless your side is behind: repeating draws the game.";
const TRADE_AHEAD = "Your side is ahead, so an even trade helps.";
const TRADE_BEHIND = "Your side is behind, so avoid an even trade.";

/**
 * The question, with advice written in the words the options use. Every word
 * here is paid for twice on every call, so advice about one kind of move is
 * only given when an option on the list, by its `noted`, is that kind.
 */
export function instructionsFor(phase: Phase, lead = 0, noted: readonly string[] = []): DecisionQuery["instructions"] {
  const said = (note: string) => noted.includes(note);
  const trades = said(NOTE.trade) && lead !== 0 ? (lead > 0 ? TRADE_AHEAD : TRADE_BEHIND) : null;
  const advice = [
    TACTICS,
    noted.some((note) => note.startsWith("sets up ")) ? PLANS : null,
    ADVICE[phase],
    lead >= WINNING_LEAD ? WINNING : null,
    said(NOTE.draws) ? DRAWS : null,
    said(NOTE.repeats) ? REPEATS : null,
    trades,
    SAFE,
  ];
  return { question: QUESTION, guidance: advice.filter((line) => line !== null).join(" ") };
}

const RECENT_PLIES = 10;

/**
 * The last few moves, numbered. The whole game would cost more on every call
 * the longer it ran, and these models do not use it: what matters about the
 * past, a position coming round again, is said in the options.
 */
function lastMoves(history: readonly string[]): string {
  if (history.length <= RECENT_PLIES) return numberedMoves(history);
  // Start on a move by white, so the numbering reads as it would in full.
  const start = history.length - RECENT_PLIES - ((history.length - RECENT_PLIES) % 2);
  const numbered = history.slice(start).map((san, i) => ((start + i) % 2 === 0 ? `${(start + i) / 2 + 1}. ${san}` : san));
  return `... ${numbered.join(" ")}`;
}

function materialText(lead: number, mover: MoveRequest["color"]): string {
  if (lead === 0) return "level";
  const ahead = lead > 0 ? mover : mover === "white" ? "black" : "white";
  return `${ahead} is ahead by ${Math.abs(lead)} (pawn 1, knight or bishop 3, rook 5, queen 9)`;
}

/** The state as plain text, for providers that take a string. */
export function stateText(state: DecisionState): string {
  return [
    `Side to move: ${state.side_to_move}`,
    `Phase: ${state.phase}`,
    `Material: ${state.material}`,
    `Last moves: ${state.last_moves}`,
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
// the board, so what a move does is stated in the option.
function option(move: LegalMove, notes: readonly string[] = []): DecisionOption {
  return { key: move.uci, description: [describeMove(move), ...notes].join(", ") };
}

/**
 * One ordering has to lead by this much before its favorite is played
 * outright. Closer than that, the probabilities pick, so two games from the
 * same quiet position do not always play the same move.
 */
const CLEAR_LEAD = 1.35;

/** The move the two orderings support, or the stated choice when no probabilities came back. */
function chooseMove(answers: readonly DecisionAnswer[], rng: () => number): string | null {
  const totals = new Map<string, number>();
  for (const answer of answers) {
    for (const [key, p] of Object.entries(answer.probabilities)) totals.set(key, (totals.get(key) ?? 0) + p);
  }
  const ranked = [...totals.entries()].filter((entry) => entry[1] > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (ranked.length === 0) return answers.find((a) => a.choice !== null)?.choice ?? null;
  const [top, second] = ranked;
  if (!second || top[1] >= second[1] * CLEAR_LEAD) return top[0];
  const band = ranked.filter((entry) => entry[1] * CLEAR_LEAD >= top[1]);
  const weight = band.reduce((sum, entry) => sum + entry[1], 0);
  let roll = rng() * weight;
  for (const [key, p] of band) {
    roll -= p;
    if (roll <= 0) return key;
  }
  return top[0];
}

// These models lean toward the first option listed, so the same question is
// asked twice in one request with the options in opposite orders, and the
// two sets of probabilities are added together.
function buildQuery(request: MoveRequest, moves: readonly LegalMove[], rng: () => number, view: Survey, notes: boolean): DecisionQuery {
  const said = notes ? moves.flatMap((m) => view.notes.get(m.uci) ?? []) : [];
  const first = shuffled(moves, rng).map((m) => option(m, notes ? view.notes.get(m.uci) : undefined));
  return {
    model: request.model,
    state: {
      side_to_move: request.color,
      phase: view.phase,
      material: materialText(view.lead, request.color),
      board: textBoard(request.fen),
      position_fen: request.fen,
      last_moves: lastMoves(request.history),
    },
    instructions: notes ? instructionsFor(view.phase, view.lead, said) : INSTRUCTIONS,
    orderings: [first, [...first].reverse()],
    signal: request.signal,
  };
}

/** An opponent that plays by asking a decision model to choose among sound moves. */
export function decisionAdapter(decide: Decider, options: DecisionOptions = {}): Adapter {
  const rng = options.rng ?? Math.random;
  return async (request) => {
    const assist = options.assist !== false;
    const notes = options.notes !== false;
    const tactical = assist ? shortlist(assessMoves(request.history)).map((a) => a.move) : request.legalMoves;
    const view = survey(request.history, notes ? tactical.map((m) => m.uci) : []);
    const moves = assist && notes ? focusMoves(view, tactical, rng) : tactical;
    // With one sound move there is nothing to ask.
    if (assist && moves.length === 1) return { kind: "move", san: moves[0].san };
    try {
      const outcome = await decide(buildQuery(request, moves, rng, view, notes));
      if ("error" in outcome) return providerError(outcome.error);
      const { inputTokens } = outcome;
      const chosen = chooseMove(outcome.answers, rng);
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
