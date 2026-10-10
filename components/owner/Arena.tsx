"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ArenaStatus } from "@/lib/arena/status";
import { api } from "@/lib/client/api";
import { PROVIDER_LABELS } from "@/lib/format";

type Entrant = ArenaStatus["models"][number];

const REFRESH_MS = 10_000;

/** `version` changes whenever a connection or an offered model changes, so the list reloads. */
export function Arena({ version }: { version: number }) {
  const [status, setStatus] = useState<ArenaStatus | null>(null);
  const [games, setGames] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Bumping this reloads the status straight away.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const response = await api<ArenaStatus>("/api/owner/arena");
      if (alive && response.success) setStatus(response.data);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [version, reloads]);

  if (!status) return <p className="muted">Loading…</p>;

  async function change(body: { gamesPerDay: number } | { provider: string; id: string; arena: boolean }) {
    const response = await api<ArenaStatus>("/api/owner/arena", "PATCH", body);
    if (!response.success) return setError(response.error);
    setError(null);
    setGames("");
    setStatus(response.data);
  }

  async function start() {
    const response = await api("/api/owner/arena", "POST");
    setError(response.success ? null : response.error);
    setReloads((n) => n + 1);
  }

  const entered = games === "" ? status.gamesPerDay : Number(games);
  const valid = Number.isInteger(entered) && entered >= 0 && entered <= status.maxGamesPerDay;
  const playing = status.models.filter((m) => m.arena).length;
  return (
    <>
      <form
        className="row arena-controls"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void change({ gamesPerDay: entered });
        }}
      >
        <label htmlFor="arena-games">Games a day</label>
        <input
          id="arena-games"
          className="field num"
          type="number"
          min={0}
          max={status.maxGamesPerDay}
          value={games === "" ? status.gamesPerDay : games}
          onChange={(e) => setGames(e.target.value)}
        />
        <button className="btn ghost small" type="submit" disabled={!valid || entered === status.gamesPerDay}>
          Save
        </button>
        <span className="meta grow">
          {status.gamesPerDay === 0 ? "off" : `${status.startedToday} of ${status.gamesPerDay} started today`}
          {status.scheduled ? "" : " · no schedule: CRON_SECRET is not set"}
        </span>
        {status.liveGameId ? (
          <Link className="btn ghost small" href={`/arena/${status.liveGameId}`}>
            Watch the live game
          </Link>
        ) : (
          <button className="btn ghost small" type="button" disabled={playing < 2} onClick={() => void start()}>
            Start a game now
          </button>
        )}
      </form>
      {error && <p className="error">{error}</p>}
      <div className="rows" style={{ marginTop: 12 }}>
        {status.models.length === 0 && <p className="row muted">No models are on offer yet.</p>}
        {status.models.map((model: Entrant) => (
          <label className="row" key={`${model.provider}/${model.id}`} style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={model.arena}
              onChange={() => void change({ provider: model.provider, id: model.id, arena: !model.arena })}
              aria-label={`${model.label} plays in the arena`}
            />
            <span className="grow">
              {model.label}
              <span className="meta" style={{ marginLeft: 12 }}>
                {PROVIDER_LABELS[model.provider]}
              </span>
            </span>
            <span className="meta">{model.note}</span>
          </label>
        ))}
      </div>
    </>
  );
}
