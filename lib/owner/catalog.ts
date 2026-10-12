import "server-only";
import { bundledModels, loadModels, type ModelCatalog } from "@neelsatyavolu/shared-ai-auth";
import { isFreeModel } from "../ai/free-models";
import { fakeEnabled } from "../ai/registry";
import { JEV_MODEL } from "../ai/jev";
import { MERCURY_MODEL } from "../ai/mercury";
import { OPENAI_DECISIONS_MODEL } from "../ai/openai-decisions";
import { SUBQ_MODEL } from "../ai/subq";
import { timeControlsFor } from "../config";
import type { Queryable } from "../db/client";
import { listConnections } from "../db/connections";
import { listModelRows, type ModelRow } from "../db/models";
import type { Provider } from "../game/types";

export type OwnerModel = {
  provider: Provider;
  id: string;
  label: string;
  supportsEffort: boolean;
  enabled: boolean;
  connected: boolean;
  /** Added by hand in the owner panel, so it can be removed there. */
  custom: boolean;
};

export type OfferedModel = {
  provider: Provider;
  id: string;
  label: string;
  supportsEffort: boolean;
  timeControls: string[];
};

export type LoadCatalog = () => Promise<Pick<ModelCatalog, "codex" | "grok">>;

/** Providers whose models the owner types in, since they have no shared catalog. */
export const CUSTOM_PROVIDERS: readonly Provider[] = ["gemini", "openrouter"];

const CATALOG_TTL_MS = 5 * 60_000;
let cached: ModelCatalog = bundledModels;
let refreshAt = 0;

const cachedCatalog: LoadCatalog = async () => {
  if (Date.now() >= refreshAt) {
    cached = await loadModels({ fallback: cached });
    refreshAt = Date.now() + CATALOG_TTL_MS;
  }
  return cached;
};

type Known = Omit<OwnerModel, "enabled" | "connected"> & { enabledByDefault: boolean };

// Catalog models spend the owner's subscription, so they start switched off.
async function knownModels(loadCatalog: LoadCatalog): Promise<Known[]> {
  const catalog = await loadCatalog();
  const fromCatalog = (provider: "codex" | "grok"): Known[] =>
    catalog[provider].map((m) => ({
      provider, id: m.id, label: m.label, supportsEffort: true, custom: false, enabledByDefault: false,
    }));
  const builtIn = (provider: Provider, id: string, label: string, enabledByDefault: boolean): Known => ({
    provider, id, label, supportsEffort: false, custom: false, enabledByDefault,
  });
  return [
    ...fromCatalog("codex"),
    ...fromCatalog("grok"),
    builtIn("jev", JEV_MODEL, "Jev", true),
    // These bill per request to the owner's own account, so they start off.
    builtIn("mercury", MERCURY_MODEL, "Mercury Decide", false),
    builtIn("subq", SUBQ_MODEL, "SubQ Snap", false),
    builtIn("openai", OPENAI_DECISIONS_MODEL, "GPT-6 Luna (Decisions)", false),
    builtIn("gateway", "liquid/d1", "Liquid d1", false),
    builtIn("gateway", "microsoft/microsoft-decision-1", "Microsoft Decision-1", false),
    ...(fakeEnabled() ? [builtIn("fake", "fake-1", "Scripted", true)] : []),
  ];
}

const sameModel = (row: ModelRow, provider: Provider, id: string): boolean =>
  row.provider === provider && row.modelId === id;

export async function listForOwner(q: Queryable, loadCatalog: LoadCatalog = cachedCatalog): Promise<OwnerModel[]> {
  const [known, rows, connections] = await Promise.all([knownModels(loadCatalog), listModelRows(q), listConnections(q)]);
  const connected = new Set<Provider>([...connections.map((c) => c.provider), ...(fakeEnabled() ? ["fake" as const] : [])]);
  const builtIn = known.map(({ enabledByDefault, ...model }) => ({
    ...model,
    enabled: rows.find((r) => sameModel(r, model.provider, model.id))?.enabled ?? enabledByDefault,
    connected: connected.has(model.provider),
  }));
  const custom = rows
    .filter((r) => CUSTOM_PROVIDERS.includes(r.provider))
    .map((r) => ({
      provider: r.provider, id: r.modelId, label: r.label, supportsEffort: r.supportsEffort,
      enabled: r.enabled, connected: connected.has(r.provider), custom: true,
    }));
  return [...builtIn, ...custom];
}

/** Whether visitors may pick this model right now. */
const isOffered = (m: OwnerModel): boolean => m.enabled && m.connected && isFreeModel(m.provider, m.id);

const offer = (m: OwnerModel): OfferedModel => ({
  provider: m.provider,
  id: m.id,
  label: m.label,
  supportsEffort: m.supportsEffort,
  timeControls: timeControlsFor(m.provider).map((t) => t.id),
});

/** The models a visitor may pick: enabled, with a connected provider, and free where that is required. */
export async function listOffered(q: Queryable, loadCatalog: LoadCatalog = cachedCatalog): Promise<OfferedModel[]> {
  return (await listForOwner(q, loadCatalog)).filter(isOffered).map(offer);
}

export async function findOffered(
  q: Queryable,
  provider: Provider,
  id: string,
  loadCatalog: LoadCatalog = cachedCatalog,
): Promise<OfferedModel | null> {
  const offered = await listOffered(q, loadCatalog);
  return offered.find((m) => m.provider === provider && m.id === id) ?? null;
}
