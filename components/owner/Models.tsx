"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { PROVIDER_LABELS } from "@/lib/format";
import type { Provider } from "@/lib/game/types";
import type { OwnerModel } from "@/lib/owner/catalog";

const ADDABLE: Provider[] = ["gemini", "openrouter"];

function AddModel({ onAdded }: { onAdded: () => void }) {
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [supportsEffort, setSupportsEffort] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const response = await api("/api/owner/models", "POST", { provider, id, label, supportsEffort });
    if (!response.success) return setError(response.error);
    setId("");
    setLabel("");
    setError(null);
    onAdded();
  }

  return (
    <form
      className="stack"
      style={{ marginTop: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <span className="label">Add a Gemini or OpenRouter model</span>
      <div className="form-grid">
        <input className="field" aria-label="Model ID" placeholder="Model ID, exactly as the provider names it" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="field" aria-label="Label" placeholder="Label players see" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className="field" aria-label="Provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
          {ADDABLE.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={supportsEffort} onChange={(e) => setSupportsEffort(e.target.checked)} />
          Has effort levels
        </label>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn ghost small" type="submit" disabled={id.trim() === "" || label.trim() === ""}>
          Add model
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  );
}

/** `version` changes whenever a connection changes, so the list reloads. */
export function Models({ version }: { version: number }) {
  const [models, setModels] = useState<OwnerModel[]>([]);

  const [edits, setEdits] = useState(0);
  const reload = () => setEdits((n) => n + 1);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const response = await api<OwnerModel[]>("/api/owner/models");
      if (alive && response.success) setModels(response.data);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [version, edits]);

  async function toggle(model: OwnerModel) {
    await api("/api/owner/models", "PATCH", { provider: model.provider, id: model.id, enabled: !model.enabled });
    reload();
  }

  async function remove(model: OwnerModel) {
    await api("/api/owner/models", "DELETE", { provider: model.provider, id: model.id });
    reload();
  }

  return (
    <>
      <div className="rows">
        {models.map((model) => (
          <label className="row" key={`${model.provider}/${model.id}`} style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={model.enabled} onChange={() => void toggle(model)} aria-label={`Offer ${model.label}`} />
            <span className="grow">
              {model.label}
              <span className="meta" style={{ marginLeft: 12 }}>
                {PROVIDER_LABELS[model.provider]}
              </span>
            </span>
            <span className="meta">
              {!model.connected ? "provider not connected" : model.enabled ? "offered to players" : "off"}
            </span>
            {model.custom && (
              <button
                className="btn danger small"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  void remove(model);
                }}
              >
                Remove
              </button>
            )}
          </label>
        ))}
      </div>
      <AddModel onAdded={reload} />
    </>
  );
}
