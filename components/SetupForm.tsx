"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import type { TimeControl } from "@/lib/config";
import { PROVIDER_LABELS } from "@/lib/format";
import type { Capacity } from "@/lib/game/limits";
import { EFFORTS, type Color, type Effort, type Provider } from "@/lib/game/types";
import type { OfferedModel } from "@/lib/owner/catalog";
import { Segmented } from "./Segmented";

type Lobby = { capacity: Capacity; models: OfferedModel[]; timeControls: TimeControl[]; activeGameId: string | null };
type Side = Color | "random";

const SIDES = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "random", label: "Random" },
] as const;

const BLOCKED_TEXT = {
  player: "You have played both of your games for today.",
  network: "This network has used its games for today.",
  global: "All of today's games have been played.",
} as const;

const keyOf = (model: Pick<OfferedModel, "provider" | "id">): string => `${model.provider}/${model.id}`;

function untilReset(resetAt: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((resetAt - now) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function groupByProvider(models: OfferedModel[]): Array<[Provider, OfferedModel[]]> {
  const providers = [...new Set(models.map((m) => m.provider))];
  return providers.map((p) => [p, models.filter((m) => m.provider === p)]);
}

/** Splits an opponent's time controls into the quick ones and the slow ones. */
function timeGroups(offered: string[], all: TimeControl[]): Array<{ name: string; ids: string[] }> {
  const fast = new Set(all.filter((t) => t.fastOnly).map((t) => t.id));
  const groups = [
    { name: "Fast", ids: offered.filter((id) => fast.has(id)) },
    { name: "Slow", ids: offered.filter((id) => !fast.has(id)) },
  ];
  return groups.filter((g) => g.ids.length > 0);
}

function CapacityCells({ capacity, now }: { capacity: Capacity; now: number }) {
  const left = (c: { used: number; limit: number }) => c.limit - c.used;
  return (
    <div className="cells">
      <div>
        <span className="label">Your games left today</span>
        <span className="figure">
          {left(capacity.player)} / {capacity.player.limit}
        </span>
      </div>
      <div>
        <span className="label">Games left for everyone</span>
        <span className="figure">
          {left(capacity.global)} / {capacity.global.limit}
        </span>
      </div>
      <div>
        <span className="label">Resets in</span>
        <span className="figure">{untilReset(capacity.resetAt, now)}</span>
      </div>
    </div>
  );
}

export function SetupForm() {
  const router = useRouter();
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [effort, setEffort] = useState<Effort>("medium");
  const [timeControl, setTimeControl] = useState("10+10");
  const [side, setSide] = useState<Side>("white");
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    api<Lobby>("/api/lobby").then((response) => {
      if (!alive) return;
      if (!response.success) return setError(response.error);
      setLobby(response.data);
      setChosen((current) => current ?? (response.data.models[0] ? keyOf(response.data.models[0]) : null));
    });
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const model = useMemo(() => lobby?.models.find((m) => keyOf(m) === chosen) ?? null, [lobby, chosen]);
  // Keep the chosen time control valid when the opponent changes.
  const control = model?.timeControls.includes(timeControl) ? timeControl : (model?.timeControls.at(-3) ?? "10+10");

  async function start() {
    if (!model) return;
    setStarting(true);
    setError(null);
    const response = await api<{ id: string }>("/api/games", "POST", {
      provider: model.provider,
      model: model.id,
      effort: model.supportsEffort ? effort : null,
      timeControl: control,
      color: side,
    });
    if (response.success) return router.push(`/game/${response.data.id}`);
    setStarting(false);
    setError(response.error);
  }

  if (!lobby) return <p className={error ? "error" : "muted"}>{error ?? "Loading…"}</p>;

  const blocked = lobby.capacity.blocked;
  return (
    <>
      <CapacityCells capacity={lobby.capacity} now={now} />

      {lobby.activeGameId && (
        <div className="notice">
          <h2>Game in progress</h2>
          <p>Your clock is running. Finish this game before starting another.</p>
          <div className="actions">
            <Link className="btn accent" href={`/game/${lobby.activeGameId}`}>
              Resume game
            </Link>
          </div>
        </div>
      )}

      {!lobby.activeGameId && blocked && (
        <div className="notice">
          <h2>Come back tomorrow</h2>
          <p>
            {BLOCKED_TEXT[blocked]} The count resets in {untilReset(lobby.capacity.resetAt, now)}, at midnight Pacific.
          </p>
        </div>
      )}

      {!lobby.activeGameId && lobby.models.length === 0 && (
        <div className="notice">
          <h2>No opponents right now</h2>
          <p>No models are switched on at the moment. Check back later.</p>
        </div>
      )}

      {!lobby.activeGameId && lobby.models.length > 0 && (
        <form
          className="setup"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <section className="section">
            <span className="label">1 · Choose an opponent</span>
            <div className="rows" role="radiogroup" aria-label="Opponent">
              {groupByProvider(lobby.models).map(([provider, models]) => (
                <div key={provider}>
                  <div className="group-title label">{PROVIDER_LABELS[provider]}</div>
                  {models.map((m) => (
                    <button
                      key={keyOf(m)}
                      type="button"
                      role="radio"
                      className="row"
                      aria-checked={keyOf(m) === chosen}
                      onClick={() => setChosen(keyOf(m))}
                    >
                      <span className="grow">{m.label}</span>
                      <span className="meta">{m.timeControls.includes("1+0") ? "fast · bullet to classical" : "slow games only"}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <aside className="setup-side">
            <span className="label">2 · Set up the game</span>
            {model?.supportsEffort && (
              <section className="section">
                <span className="label">Effort</span>
                <Segmented
                  label="Effort"
                  value={effort}
                  onChange={setEffort}
                  options={EFFORTS.map((e) => ({ value: e, label: e }))}
                />
              </section>
            )}

            <section className="section">
              <span className="label">Time (minutes + seconds per move)</span>
              {timeGroups(model?.timeControls ?? [], lobby.timeControls).map((group) => (
                <div className="pair" key={group.name}>
                  <span className="label">{group.name}</span>
                  <Segmented
                    label={`${group.name} time controls`}
                    value={control}
                    onChange={setTimeControl}
                    options={group.ids.map((id) => ({ value: id, label: id }))}
                  />
                </div>
              ))}
            </section>

            <section className="section">
              <span className="label">You play</span>
              <Segmented label="You play" value={side} onChange={setSide} options={SIDES} />
            </section>

            <div className="summary">
              {model ? `${model.label} · ${control} · you play ${side}` : "Choose an opponent"}
            </div>
            <button className="btn accent" type="submit" disabled={starting || Boolean(blocked) || !model}>
              {starting ? "Starting…" : "Start game"}
            </button>
            {error && <span className="error">{error}</span>}
          </aside>
        </form>
      )}
    </>
  );
}
