"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ConnectionStatus } from "@/lib/owner/admin";

type Note = { provider: string; text: string; good: boolean };

function SignIn({ status, onDone }: { status: ConnectionStatus; onDone: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const base = `/api/owner/connections/${status.provider}/oauth`;

  async function begin() {
    setError(null);
    const response = await api<{ url: string }>(base, "POST", { action: "start" });
    if (response.success) setUrl(response.data.url);
    else setError(response.error);
  }

  async function finish() {
    const response = await api(base, "POST", { action: "finish", pasted });
    if (!response.success) return setError(response.error);
    setUrl(null);
    setPasted("");
    onDone();
  }

  if (!url) {
    return (
      <>
        <button className="btn ghost small" type="button" onClick={() => void begin()}>
          {status.connected ? "Sign in again" : "Sign in"}
        </button>
        {error && <span className="error">{error}</span>}
      </>
    );
  }
  return (
    <div className="stack" style={{ flexBasis: "100%" }}>
      <p className="muted" style={{ margin: 0 }}>
        1. <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Open the {status.label} sign-in page</a> and
        sign in. 2. You will land on a page that fails to load. Copy its full address (or the code shown) and paste it here.
      </p>
      <textarea
        className="field"
        aria-label="Callback address or code"
        placeholder="http://localhost… or the code"
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn small" type="button" disabled={pasted.trim().length === 0} onClick={() => void finish()}>
          Finish sign-in
        </button>
        <button className="btn ghost small" type="button" onClick={() => setUrl(null)}>
          Cancel
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

function KeyEntry({ status, onDone }: { status: ConnectionStatus; onDone: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const response = await api(`/api/owner/connections/${status.provider}`, "PUT", { apiKey });
    if (!response.success) return setError(response.error);
    setApiKey("");
    setError(null);
    onDone();
  }

  return (
    <>
      <input
        className="field"
        style={{ maxWidth: 260 }}
        type="password"
        autoComplete="off"
        aria-label={`${status.label} API key`}
        placeholder={status.connected ? "Replace the key" : "Paste the API key"}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />
      <button className="btn ghost small" type="button" disabled={apiKey.trim().length < 8} onClick={() => void save()}>
        Save
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}

export function Connections({ onChange }: { onChange: () => void }) {
  const [list, setList] = useState<ConnectionStatus[]>([]);
  const [note, setNote] = useState<Note | null>(null);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const response = await api<ConnectionStatus[]>("/api/owner/connections");
      if (alive && response.success) setList(response.data);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [version]);

  const changed = () => {
    setVersion((v) => v + 1);
    onChange();
  };

  async function test(provider: string) {
    setNote({ provider, text: "Testing…", good: true });
    const response = await api(`/api/owner/connections/${provider}/test`, "POST");
    setNote({ provider, text: response.success ? "Working." : response.error, good: response.success });
  }

  async function disconnect(status: ConnectionStatus) {
    if (!window.confirm(`Disconnect ${status.label}? Its models will stop being offered.`)) return;
    await api(`/api/owner/connections/${status.provider}`, "DELETE");
    setNote(null);
    changed();
  }

  return (
    <div className="rows">
      {list.map((status) => (
        <div className="row" key={status.provider} style={{ flexWrap: "wrap" }}>
          <span className={`dot ${status.connected ? "ok" : ""}`} />
          <span className="grow">
            {status.label}
            <span className="meta" style={{ marginLeft: 12 }}>
              {status.connected ? "connected" : "not connected"}
            </span>
            <span className="muted" style={{ marginLeft: 12 }}>
              {status.note}
            </span>
            {note?.provider === status.provider && (
              <span className={note.good ? "muted" : "error"} style={{ marginLeft: 12 }}>
                {note.text}
              </span>
            )}
          </span>
          {status.kind === "oauth" ? <SignIn status={status} onDone={changed} /> : <KeyEntry status={status} onDone={changed} />}
          {status.connected && (
            <>
              <button className="btn ghost small" type="button" onClick={() => void test(status.provider)}>
                Test
              </button>
              <button className="btn danger small" type="button" onClick={() => void disconnect(status)}>
                Disconnect
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
