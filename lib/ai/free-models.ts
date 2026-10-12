import type { Provider } from "../game/types";

export type FreeModel = { id: string; label: string; supportsEffort: boolean };

/**
 * Gemini text models with a free tier, from Google's pricing page on
 * 2026-10-09. The list is explicit on purpose: "flash" in a name is not a
 * promise (Gemini Omni Flash has no free tier), so a new model is only
 * allowed once it has been checked and added here.
 *
 * Free applies only while the API key's Google project has no billing set up.
 */
export const GEMINI_FREE_MODELS: readonly FreeModel[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", supportsEffort: true },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", supportsEffort: true },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", supportsEffort: true },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", supportsEffort: false },
];

/** OpenRouter's router that only ever picks a free model. */
const OPENROUTER_FREE_ROUTER = "openrouter/free";
const OPENROUTER_FREE_SUFFIX = ":free";

/**
 * Whether using this model can cost money. OpenRouter and Gemini are only
 * ever allowed their free models; the other providers are not restricted here.
 */
export function isFreeModel(provider: Provider, id: string): boolean {
  if (provider === "openrouter") return id === OPENROUTER_FREE_ROUTER || id.endsWith(OPENROUTER_FREE_SUFFIX);
  if (provider === "gemini") return GEMINI_FREE_MODELS.some((m) => m.id === id);
  return true;
}

/** The rule in words, for telling the owner why a model was refused. */
export function freeModelRule(provider: Provider): string {
  if (provider === "openrouter") return "Only free OpenRouter models are allowed: the ID must end in :free.";
  if (provider === "gemini") {
    return `Only Gemini models with a free tier are allowed: ${GEMINI_FREE_MODELS.map((m) => m.id).join(", ")}.`;
  }
  return "";
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

type Listed = { id?: unknown; name?: unknown; supported_parameters?: unknown };

/** OpenRouter's free models right now, from its public list. Empty if the list cannot be loaded. */
export async function openRouterFreeModels(fetcher: typeof fetch = fetch): Promise<FreeModel[]> {
  try {
    const response = await fetcher(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: Listed[] };
    return (body.data ?? [])
      .filter((m): m is Listed & { id: string } => typeof m.id === "string" && m.id.endsWith(OPENROUTER_FREE_SUFFIX))
      .map((m) => ({
        id: m.id,
        label: (typeof m.name === "string" ? m.name : m.id).replace(/\s*\(free\)\s*$/i, ""),
        supportsEffort: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("reasoning"),
      }));
  } catch {
    return [];
  }
}
