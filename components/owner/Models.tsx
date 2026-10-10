"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { PROVIDER_LABELS } from "@/lib/format";
import type { Provider } from "@/lib/game/types";
import type { Suggestion } from "@/lib/owner/admin";
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
      <span className="label">Add a free Gemini or OpenRouter model by ID</span>
      <div className="form-grid">
        <input className="field" aria-label="Model ID" placeholder="Model ID (OpenRouter IDs end in :free)" value={id} onChange={(e) => setId(e.target.value)} />
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

function Suggestions({ items, onAdd }: { items: Suggestion[]; onAdd: (model: Suggestion) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="stack" style={{ marginTop: 24 }}>
      <span className="label">Suggested free models</span>
      <p className="muted" style={{ margin: 0 }}>
        OpenRouter and Gemini are limited to free models; anything else is refused. Gemini is free only while the
        Google project behind your key has no billing set up.
      </p>
      <div className="rows">
        {items.map((model) => (
          <div className="row" key={`${model.provider}/${model.id}`}>
            <span className="grow">
              {model.label}
              <span className="meta" style={{ marginLeft: 12 }}>
                {PROVIDER_LABELS[model.provider]}
              </span>
            </span>
            <span className="meta num" style={{ textTransform: "none" }}>
              {model.id}
            </span>
            <button className="btn ghost small" type="button" onClick={() => onAdd(model)}>
              Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** `version` changes whenever a connection changes, so the list reloads. */
export function Models({ version }: { version: number }) {
  const [models, setModels] = useState<OwnerModel[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const [edits, setEdits] = useState(0);
  const reload = () => setEdits((n) => n + 1);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [listed, suggested] = await Promise.all([
        api<OwnerModel[]>("/api/owner/models"),
        api<Suggestion[]>("/api/owner/models/suggestions"),
      ]);
      if (!alive) return;
      if (listed.success) setModels(listed.data);
      if (suggested.success) setSuggestions(suggested.data);
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

  async function addSuggested(model: Suggestion) {
    await api("/api/owner/models", "POST", model);
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
      <Suggestions items={suggestions} onAdd={(model) => void addSuggested(model)} />
      <AddModel onAdded={reload} />
    </>
  );
}
