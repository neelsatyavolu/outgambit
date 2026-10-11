import type { Provider } from "../game/types";

/**
 * What a budget is counted in: the percent a subscription's own meter shows,
 * requests against a free daily limit, or cents of a paid model's daily cap.
 */
export type PoolKind = "meter" | "requests" | "cents";

/** One budget. Models that share an id draw on the same one. */
export type Pool = { id: string; kind: PoolKind };

/** Why no game can start against a model, whoever asks. */
export type Closed = "pace" | "short_window" | "free_limit" | "daily_budget" | "usage_unavailable" | "rate_limited";

/**
 * The budget a model draws on. A subscription has one meter for all its
 * models, and so has OpenRouter's free limit; Gemini's free limit and the
 * paid cap are per model. Null for the scripted opponent, which costs nothing.
 */
export function budgetPool(provider: Provider, model: string): Pool | null {
  switch (provider) {
    case "codex":
    case "grok":
      return { id: provider, kind: "meter" };
    case "openrouter":
      return { id: provider, kind: "requests" };
    case "gemini":
      return { id: `${provider}/${model}`, kind: "requests" };
    case "jev":
    case "mercury":
    case "openai":
    case "gateway":
      return { id: `${provider}/${model}`, kind: "cents" };
    case "fake":
      return null;
  }
}
