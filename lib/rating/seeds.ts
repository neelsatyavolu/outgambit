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
 * - The decision models (Jev and the like) only choose among moves that code
 *   has already checked one move deep, which plays like a careful beginner:
 *   about 850. They answer instantly, which is worth more at bullet.
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
  jev: { "jev-latest": 850 },
  mercury: { "mercury-decide": 850 },
  openai: { "gpt-6-luna": 850 },
  gateway: { "liquid/d1": 800, "microsoft/microsoft-decision-1": 800 },
};

/** For a model that is not listed above. */
const PROVIDER_DEFAULT: Record<Provider, number> = {
  codex: 1000,
  grok: 950,
  gemini: 800,
  openrouter: 600,
  jev: 850,
  mercury: 850,
  openai: 850,
  gateway: 800,
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
