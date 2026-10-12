import { isFastProvider } from "../config";
import type { Effort, Provider } from "../game/types";
import type { Pool } from "./elo";

/**
 * Where each model's rating starts, before it has played anyone here. These
 * are estimates on roughly the chess.com scale, and play moves them from the
 * first game on. Basis, as of October 2026:
 *
 * - Published tests put even the best reasoning LLMs below a 1100-rated
 *   human-like engine when given the legal moves (ChessArena, ACL 2026), and
 *   non-reasoning models far lower (LLM Chess, 2025). So flagship models at
 *   high effort start a little above 1200 and small free models near 600.
 * - The decision models play the assisted hybrid: local tactics and notes,
 *   then one call when the notes do not already settle the move. In October
 *   2026 that hybrid scored 23/36 against Stockfish 19 held to UCI_Elo 1320
 *   (6 games each, colors alternating, 80 ms a move; a game still going at
 *   100 plies counts as a win only when a queen ahead, otherwise a draw).
 *   That is +99 ± 118,
 *   about 1420. The six models overlapped inside that margin, so they share
 *   1400, rounded to the nearest 50. UCI_Elo is a CCRL figure; around 1400
 *   it sits close to this site's chess.com-like scale. A notes-only stand-in,
 *   with no model call, scored about 1390 ± 150 against the same engine.
 *   Bullet still adds 100, because they answer instantly. The match measured
 *   move quality with time left, not a 1+0 clock.
 */
const BASE: Partial<Record<Provider, Record<string, number>>> = {
  codex: { "gpt-6-astra": 1100, "gpt-6.1-sol": 1000, "gpt-6-luna": 850 },
  grok: { "grok-4.7": 1000, "grok-4.6": 950 },
  gemini: {
    "gemini-3.8-flash": 1000,
    "gemini-3.6-flash": 950,
    "gemini-3-flash-preview": 900,
    "gemini-3.5-flash-lite": 700,
    "gemini-3.1-flash-lite": 650,
  },
  jev: { "jev-latest": 1400 },
  mercury: { "mercury-decide": 1400 },
  subq: { "subq-snap-preview": 1400 },
  openai: { "gpt-6-luna": 1400 },
  gateway: { "liquid/d1": 1400, "microsoft/microsoft-decision-1": 1400 },
};

/** For a model that is not listed above. */
const PROVIDER_DEFAULT: Record<Provider, number> = {
  codex: 1000,
  grok: 950,
  gemini: 800,
  openrouter: 600,
  jev: 1400,
  mercury: 1400,
  subq: 1400,
  openai: 1400,
  gateway: 1400,
  fake: 600,
};

const EFFORT_SHIFT: Record<Effort, number> = { low: -120, medium: 0, high: 120 };
const BULLET_BONUS = 100;

/** A model is rated separately at each effort, since effort changes how well it plays. */
export function modelKey(provider: Provider, model: string, effort: Effort | null): string {
  return effort ? `${provider}/${model}#${effort}` : `${provider}/${model}`;
}

export function seedRating(provider: Provider, model: string, effort: Effort | null, pool: Pool): number {
  const base = BASE[provider]?.[model] ?? PROVIDER_DEFAULT[provider];
  const withEffort = base + (effort ? EFFORT_SHIFT[effort] : 0);
  return withEffort + (pool === "bullet" && isFastProvider(provider) ? BULLET_BONUS : 0);
}
