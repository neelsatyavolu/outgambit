import "server-only";
import { GEMINI_FREE_MODELS, freeModelRule, isFreeModel, openRouterFreeModels, type FreeModel } from "../ai/free-models";
import { GATEWAY_CREDITS_URL } from "../ai/gateway";
import { testJevKey } from "../ai/jev";
import { testOpenAiKey } from "../ai/openai-decisions";
import type { Db, Queryable } from "../db/client";
import { listConnections } from "../db/connections";
import { deleteModel, listModelRows, upsertModel } from "../db/models";
import type { Provider } from "../game/types";
import { CUSTOM_PROVIDERS, listForOwner, type LoadCatalog } from "./catalog";
import { getCredentials, saveSecret } from "./credentials";

export type ConnectionKind = "oauth" | "key";
export type ConnectionStatus = {
  provider: Provider;
  label: string;
  kind: ConnectionKind;
  connected: boolean;
  updatedAt: number | null;
};

export const CONNECTABLE: ReadonlyArray<{ provider: Provider; label: string; kind: ConnectionKind }> = [
  { provider: "codex", label: "ChatGPT", kind: "oauth" },
  { provider: "grok", label: "Grok", kind: "oauth" },
  { provider: "gemini", label: "Gemini", kind: "key" },
  { provider: "openrouter", label: "OpenRouter", kind: "key" },
  { provider: "jev", label: "Jev (TypeSafe)", kind: "key" },
  { provider: "openai", label: "OpenAI Decisions", kind: "key" },
  { provider: "gateway", label: "Vercel AI Gateway", kind: "key" },
];

export const connectionKind = (provider: string): ConnectionKind | null =>
  CONNECTABLE.find((c) => c.provider === provider)?.kind ?? null;

export async function connectionStatus(q: Queryable): Promise<ConnectionStatus[]> {
  const stored = await listConnections(q);
  return CONNECTABLE.map((c) => {
    const found = stored.find((s) => s.provider === c.provider);
    return { ...c, connected: Boolean(found), updatedAt: found?.updatedAt ?? null };
  });
}

/** Stores an API key. False if this provider connects by signing in instead. */
export async function saveApiKey(q: Queryable, provider: Provider, apiKey: string, now: number): Promise<boolean> {
  if (connectionKind(provider) !== "key") return false;
  await saveSecret(q, provider, { kind: "key", apiKey: apiKey.trim() }, now);
  return true;
}

const KEY_CHECK_URLS: Partial<Record<Provider, string>> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/models",
  openrouter: "https://openrouter.ai/api/v1/key",
  gateway: GATEWAY_CREDITS_URL,
};

export type TestResult = { ok: true } | { ok: false; error: string };

async function checkKey(provider: Provider, apiKey: string, fetcher: typeof fetch): Promise<TestResult> {
  if (provider === "jev") {
    return (await testJevKey(apiKey, fetcher)) ? { ok: true } : { ok: false, error: "TypeSafe refused the key." };
  }
  if (provider === "openai") {
    return (await testOpenAiKey(apiKey, fetcher)) ? { ok: true } : { ok: false, error: "OpenAI refused the key." };
  }
  const url = KEY_CHECK_URLS[provider];
  if (!url) return { ok: false, error: "Nothing to test." };
  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `The provider answered HTTP ${response.status}.` };
  } catch {
    return { ok: false, error: "Could not reach the provider." };
  }
}

/** Makes the cheapest call that proves the stored credentials still work. */
export async function testConnection(
  db: Db,
  provider: Provider,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<TestResult> {
  try {
    const secret = await getCredentials(db, provider, now);
    if (!secret) return { ok: false, error: "Not connected." };
    // A sign-in is good if its tokens are valid or could just be refreshed.
    return secret.kind === "oauth" ? { ok: true } : await checkKey(provider, secret.apiKey, fetcher);
  } catch {
    return { ok: false, error: "The sign-in could not be refreshed. Connect again." };
  }
}

/** Switches a known model on or off for players. False if there is no such model. */
export async function setModelEnabled(
  q: Queryable,
  provider: Provider,
  id: string,
  enabled: boolean,
  loadCatalog?: LoadCatalog,
): Promise<boolean> {
  const model = (await listForOwner(q, loadCatalog)).find((m) => m.provider === provider && m.id === id);
  if (!model || (enabled && !isFreeModel(provider, id))) return false;
  await upsertModel(q, { provider, modelId: id, label: model.label, supportsEffort: model.supportsEffort, enabled });
  return true;
}

export type CustomModel = { provider: Provider; id: string; label: string; supportsEffort: boolean };

export type AddResult = { ok: true } | { ok: false; error: string };

/**
 * Adds a model the owner typed in. Only for providers without a shared
 * catalog, and only models that cost nothing.
 */
export async function addCustomModel(q: Queryable, model: CustomModel): Promise<AddResult> {
  if (!CUSTOM_PROVIDERS.includes(model.provider)) {
    return { ok: false, error: "Models can only be added for Gemini and OpenRouter." };
  }
  const id = model.id.trim();
  if (!isFreeModel(model.provider, id)) return { ok: false, error: freeModelRule(model.provider) };
  await upsertModel(q, {
    provider: model.provider,
    modelId: id,
    label: model.label.trim(),
    supportsEffort: model.supportsEffort,
    enabled: true,
  });
  return { ok: true };
}

export async function removeCustomModel(q: Queryable, provider: Provider, id: string): Promise<boolean> {
  if (!CUSTOM_PROVIDERS.includes(provider)) return false;
  await deleteModel(q, provider, id);
  return true;
}

const SUGGESTION_TTL_MS = 10 * 60_000;
let cachedOpenRouter: { at: number; models: FreeModel[] } | null = null;

async function cachedOpenRouterFreeModels(): Promise<FreeModel[]> {
  if (cachedOpenRouter && Date.now() - cachedOpenRouter.at < SUGGESTION_TTL_MS) return cachedOpenRouter.models;
  const models = await openRouterFreeModels();
  // An empty answer usually means the list could not be loaded, so it is not kept.
  if (models.length > 0) cachedOpenRouter = { at: Date.now(), models };
  return models;
}

export type Suggestion = CustomModel;

/** Free models the owner has not added yet: Gemini's free tier and OpenRouter's current free list. */
export async function suggestedFreeModels(
  q: Queryable,
  loadOpenRouter: () => Promise<FreeModel[]> = cachedOpenRouterFreeModels,
): Promise<Suggestion[]> {
  const [existing, openRouter] = await Promise.all([listModelRows(q), loadOpenRouter()]);
  const added = new Set(existing.map((m) => `${m.provider}/${m.modelId}`));
  const all: Suggestion[] = [
    ...GEMINI_FREE_MODELS.map((m) => ({ provider: "gemini" as const, ...m })),
    ...openRouter.map((m) => ({ provider: "openrouter" as const, ...m })),
  ];
  return all.filter((m) => !added.has(`${m.provider}/${m.id}`));
}
