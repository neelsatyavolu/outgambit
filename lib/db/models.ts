import type { Provider } from "../game/types";
import type { Queryable } from "./client";

export type ModelRow = {
  provider: Provider;
  modelId: string;
  label: string;
  supportsEffort: boolean;
  enabled: boolean;
  /** Whether the model takes part in the arena. Null leaves it to the provider's default. */
  arena: boolean | null;
};

export async function listModelRows(q: Queryable): Promise<ModelRow[]> {
  const rows = await q.query("SELECT * FROM models ORDER BY provider, label");
  return rows.map((r) => ({
    provider: r.provider as Provider,
    modelId: r.model_id as string,
    label: r.label as string,
    supportsEffort: r.supports_effort as boolean,
    enabled: r.enabled as boolean,
    arena: (r.arena as boolean | null) ?? null,
  }));
}

/** Adds or replaces a model. Leaving `arena` out keeps whatever the row already says. */
export async function upsertModel(q: Queryable, m: Omit<ModelRow, "arena"> & { arena?: boolean }): Promise<void> {
  await q.query(
    `INSERT INTO models (provider, model_id, label, supports_effort, enabled, arena) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, model_id) DO UPDATE
       SET label = EXCLUDED.label, supports_effort = EXCLUDED.supports_effort, enabled = EXCLUDED.enabled,
           arena = COALESCE(EXCLUDED.arena, models.arena)`,
    [m.provider, m.modelId, m.label, m.supportsEffort, m.enabled, m.arena ?? null],
  );
}

export async function deleteModel(q: Queryable, provider: Provider, modelId: string): Promise<void> {
  await q.query("DELETE FROM models WHERE provider = $1 AND model_id = $2", [provider, modelId]);
}

export async function deleteModelsFor(q: Queryable, provider: Provider): Promise<void> {
  await q.query("DELETE FROM models WHERE provider = $1", [provider]);
}
