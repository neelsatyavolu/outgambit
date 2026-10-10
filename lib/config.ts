import type { Provider } from "./game/types";

/**
 * Games per Pacific day: for one player, for one network (a backstop against
 * one person making several accounts), and for everyone together.
 */
export const LIMITS = { playerPerDay: 5, ipPerDay: 10, globalPerDay: 12 } as const;

export const DAY_TIME_ZONE = "America/Los_Angeles";

/** One LLM call may not outlast this, whatever the clock says. */
export const LLM_CALL_TIMEOUT_MS = 240_000;
export const JEV_TIMEOUT_MS = 3_000;
/** One call to any other decision model (OpenAI Decisions, AI Gateway). */
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
 * The arena: models playing each other with nobody watching, so the ratings
 * rest on more than the games people happen to play. Every move is a call to
 * a provider, so all of it is capped.
 */
export const ARENA = {
  /** Games started per Pacific day unless the owner sets another number. Zero switches the arena off. */
  gamesPerDay: 6,
  /** The schedule starts one game an hour at most, so a day cannot hold more than this. */
  maxGamesPerDay: 24,
  /** The time control played in each pool. */
  timeControls: { bullet: "3+0", regular: "10+10" },
  /** The effort a model with effort levels plays at. */
  effort: "medium",
  /** A game still going after this many plies is called a draw, so two models cannot shuffle for ever. */
  maxPlies: 200,
  /**
   * How long into a run a model may still be asked. The routes' maxDuration is
   * 800 s; the rest is for a call that first has to refresh its credentials,
   * and for handing the game to the next run.
   */
  runBudgetMs: 740_000,
} as const;

/** Providers that spend the owner's own subscription. Their models stay out of the arena until ticked. */
const SUBSCRIPTION_PROVIDERS: readonly Provider[] = ["codex", "grok"];

export const inArenaByDefault = (provider: Provider): boolean => !SUBSCRIPTION_PROVIDERS.includes(provider);

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
const FAST_PROVIDERS: readonly Provider[] = ["jev", "openai", "gateway", "fake"];

export const isFastProvider = (provider: Provider): boolean => FAST_PROVIDERS.includes(provider);

export function timeControlsFor(provider: Provider): TimeControl[] {
  return TIME_CONTROLS.filter((t) => !t.fastOnly || isFastProvider(provider));
}

export function findTimeControl(id: string): TimeControl | undefined {
  return TIME_CONTROLS.find((t) => t.id === id);
}
