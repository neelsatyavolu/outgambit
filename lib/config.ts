import { EFFORTS, type Effort, type Provider } from "./game/types";

/**
 * What Gambit may use of the owner's accounts. Each budget is checked when a
 * game starts; a game already being played is always finished.
 */
export const BUDGET = {
  /** The most of a subscription's weekly allowance that may be used by the time it resets, whoever used it. */
  weeklyShare: 0.5,
  /** How far ahead of an even pace through the week usage may run, in percent of the weekly allowance. */
  paceLeewayPercent: 10,
  /** The most of a subscription's short window (ChatGPT's five hours) that may be used. */
  shortWindowShare: 0.5,
  /**
   * A guess at how much of a weekly allowance one game uses, in percent. The
   * meter is what stops play; this decides how many games may start on the
   * headroom it shows, and so how they are split. Set too low, games started
   * together can take the meter past the pace line before it is read again.
   */
  percentPerGame: 1,
  /** What each paid model may cost in a Pacific day, in US cents. */
  centsPerDay: 10,
  /** Free-model requests OpenRouter allows an account in a day: before it has bought credits, and after. */
  openRouterRequestsPerDay: { free: 50, paid: 1000 },
  /** Google shows a project's free daily limit only in AI Studio, so this is a cautious stand-in for each model. */
  geminiRequestsPerDay: 100,
  /** Calls a game takes, until a model has finished games to measure. */
  callsPerGame: 40,
  /** Never count on a game taking fewer calls than this, however short the recent ones were. */
  minCallsPerGame: 10,
  /** Input tokens a decision model's call takes, until it has calls to measure. */
  tokensPerCall: 1_500,
  /** A network may use this many players' shares: a backstop against one person making several accounts. */
  networkShares: 2,
  /** How long a reading of a provider's own usage is trusted before it is read again. */
  readingFreshMs: 5 * 60_000,
  /** How long to wait before asking again after a reading failed. */
  readingRetryMs: 60_000,
  /** A reading older than this is not trusted at all, and the budget closes until one succeeds. */
  readingStaleMs: 60 * 60_000,
  /** How long a free budget stays closed after its provider answers "too many requests". */
  rateLimitPauseMs: 60 * 60_000,
} as const;

/**
 * US cents per million input tokens for the paid decision models, from each
 * provider's price list on 2026-10-10. Mercury Decide is Inception's discounted
 * price on 2026-10-11. None of them charges for output.
 */
const CENTS_PER_MILLION_TOKENS: Readonly<Record<string, number>> = {
  "jev/jev-latest": 4.2,
  "mercury/mercury-decide": 2,
  "openai/gpt-6-luna": 10,
  "gateway/liquid/d1": 4,
  "gateway/microsoft/microsoft-decision-1": 4.2,
};

/** A paid model missing from the list is charged at the dearest price on it. */
export const centsPerMillionTokens = (provider: Provider, model: string): number =>
  CENTS_PER_MILLION_TOKENS[`${provider}/${model}`] ?? Math.max(...Object.values(CENTS_PER_MILLION_TOKENS));

export const DAY_TIME_ZONE = "America/Los_Angeles";

/** One LLM call may not outlast this, whatever the clock says. */
export const LLM_CALL_TIMEOUT_MS = 240_000;
export const JEV_TIMEOUT_MS = 3_000;
/** One call to any other decision model (Mercury Decide, OpenAI Decisions, AI Gateway). */
export const DECISION_TIMEOUT_MS = 5_000;
/** The longest a turn by a fast opponent may hold its lease per call. */
export const FAST_CALL_TIMEOUT_MS = 10_000;
/** Time a slow opponent's call may spend fetching or refreshing credentials first. */
export const CREDENTIAL_ALLOWANCE_MS = 25_000;
/**
 * How long one background job may work on a turn. It must stay under the
 * routes' maxDuration (300 s), and leave room for one full call.
 */
export const AI_JOB_BUDGET_MS = 270_000;
/** Extra time a lease outlives its call, so a slow commit is not mistaken for a dead turn. */
export const LEASE_MARGIN_MS = 15_000;
/** Illegal replies allowed before the AI forfeits. */
export const MAX_INVALID_REPLIES = 3;
/** Provider failures allowed before the game is aborted. */
export const MAX_PROVIDER_FAILURES = 2;

/**
 * Models that take too long over a hard move at medium effort for a timed
 * game: about a minute or more when timed in October 2026. They play at low
 * only.
 */
const LOW_EFFORT_ONLY: Partial<Record<Provider, readonly string[]>> = { grok: ["grok-4.7", "grok-4.6"] };

/** The efforts a model with effort levels can be played at, lowest first. */
export function effortsFor(provider: Provider, model: string): readonly Effort[] {
  return LOW_EFFORT_ONLY[provider]?.includes(model) ? ["low"] : EFFORTS;
}

/** The effort a model is played at: the one asked for if the model offers it, otherwise the highest it does. */
export function effortFor(provider: Provider, model: string, wanted: Effort): Effort {
  const offered = effortsFor(provider, model);
  return offered.includes(wanted) ? wanted : offered[offered.length - 1];
}

export type TimeControl = { id: string; initialMs: number; incrementMs: number; fastOnly: boolean };

const control = (minutes: number, incrementSeconds: number, fastOnly: boolean): TimeControl => ({
  id: `${minutes}+${incrementSeconds}`,
  initialMs: minutes * 60_000,
  incrementMs: incrementSeconds * 1_000,
  fastOnly,
});

export const TIME_CONTROLS: readonly TimeControl[] = [
  control(1, 0, true),
  control(2, 1, true),
  control(3, 0, true),
  control(5, 0, true),
  control(10, 10, false),
  control(20, 20, false),
  control(45, 30, false),
];

/** Providers quick enough for bullet and blitz. */
const FAST_PROVIDERS: readonly Provider[] = ["jev", "mercury", "openai", "gateway", "fake"];

export const isFastProvider = (provider: Provider): boolean => FAST_PROVIDERS.includes(provider);

/** Providers whose models pick a move from a list (see lib/ai/decision.ts). They play one-minute games only. */
const DECISION_PROVIDERS: readonly Provider[] = ["jev", "mercury", "openai", "gateway"];
const DECISION_TIME_CONTROL = "1+0";

/**
 * The controls an LLM is offered. Its clock runs for the whole of each reply,
 * which can take half a minute; at 10+10 that costs more than the increment
 * gives back, and the model loses on time instead of on the board.
 */
const LLM_TIME_CONTROLS: readonly string[] = ["20+20", "45+30"];

export function timeControlsFor(provider: Provider): TimeControl[] {
  if (DECISION_PROVIDERS.includes(provider)) return TIME_CONTROLS.filter((t) => t.id === DECISION_TIME_CONTROL);
  if (!isFastProvider(provider)) return TIME_CONTROLS.filter((t) => LLM_TIME_CONTROLS.includes(t.id));
  return [...TIME_CONTROLS];
}

export function findTimeControl(id: string): TimeControl | undefined {
  return TIME_CONTROLS.find((t) => t.id === id);
}
