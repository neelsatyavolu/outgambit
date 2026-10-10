"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { winRate, type Line, type Stats, type Tally } from "@/lib/account/stats";
import { api } from "@/lib/client/api";
import { outcomeText } from "@/lib/format";
import type { Color, Effort, RatingChange, Reason, Result, Status } from "@/lib/game/types";
import { POOLS, POOL_LABELS, type Pool, type Skill } from "@/lib/rating/elo";
import { SkillPicker } from "./SkillPicker";

type Summary = {
  id: string;
  day: string;
  modelLabel: string;
  effort: Effort | null;
  timeControl: string;
  playerColor: Color;
  status: Status;
  result: Result | null;
  reason: Reason | null;
  rating: RatingChange | null;
};

type AccountData = {
  email: string;
  ratings: Record<Pool, number | null>;
  rated: Record<Pool, number>;
  needsSkill: boolean;
  stats: Stats;
  games: Summary[];
};

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

/** Shown to an account that has not yet said how strong the player is. */
function ChooseSkill({ onSaved }: { onSaved: () => void }) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const response = await api("/api/account/skill", "PUT", skill);
    if (response.success) onSaved();
    else setError(response.error);
  }

  return (
    <div className="notice">
      <h2>One thing before you play</h2>
      <p>Games are rated, so we need a starting point for your rating.</p>
      <div className="login" style={{ marginTop: 16 }}>
        <SkillPicker onChange={setSkill} />
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn accent" type="button" disabled={!skill} onClick={() => void save()}>
            Save
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </div>
    </div>
  );
}

const SIGNED_OUT = "Sign in first.";

const rateText = (tally: Tally): string => {
  const rate = winRate(tally);
  return rate === null ? "—" : `${rate}%`;
};

function Breakdown({ label, lines }: { label: string; lines: Line[] }) {
  return (
    <section className="section">
      <span className="label">{label}</span>
      <div className="rows">
        {lines.map((line) => (
          <div className="row" key={line.name}>
            <span className="grow">{line.name}</span>
            <span className="meta num">
              {line.won} won · {line.lost} lost · {line.drawn} drawn
            </span>
            <span className="meta num">{rateText(line)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function History({ games }: { games: Summary[] }) {
  if (games.length === 0) {
    return (
      <p className="muted">
        No games yet. <Link href="/">Play one</Link>.
      </p>
    );
  }
  return (
    <div className="rows">
      {games.map((game) => (
        <Link className="row" key={game.id} href={`/game/${game.id}`}>
          <span className={`dot ${game.status === "active" ? "live" : ""}`} />
          <span className="grow">
            {game.modelLabel}
            <span className="meta" style={{ marginLeft: 12 }}>
              {[game.effort, game.timeControl, game.playerColor, game.day].filter(Boolean).join(" · ")}
            </span>
          </span>
          {game.rating && <span className="meta num">{signed(game.rating.playerAfter - game.rating.playerBefore)}</span>}
          <span className="meta">{outcomeText(game)}</span>
        </Link>
      ))}
    </div>
  );
}

export function Account() {
  const router = useRouter();
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const response = await api<AccountData>("/api/account");
      if (!alive) return;
      if (response.success) setData(response.data);
      // The session ended since the page was rendered, so show the sign-in form again.
      else if (response.error === SIGNED_OUT) router.refresh();
      else setError(response.error);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [router, reloads]);

  async function signOut() {
    await api("/api/account/logout", "POST");
    router.refresh();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { overall, byModel, byTimeControl, byColor } = data.stats;
  // Four figures fill one row of the grid; the games played sit in the heading.
  const figures: ReadonlyArray<[label: string, value: string | number, id: string]> = [
    ["Won", overall.won, "won"],
    ["Lost", overall.lost, "lost"],
    ["Drawn", overall.drawn, "drawn"],
    ["Win rate", rateText(overall), "rate"],
  ];

  return (
    <>
      <p className="muted">Signed in as {data.email}</p>
      {data.needsSkill && <ChooseSkill onSaved={() => setReloads((n) => n + 1)} />}
      <section className="section">
        <span className="label">Your ratings</span>
        <div className="cells">
          {POOLS.map((pool) => (
            <div key={pool}>
              <span className="label">
                {POOL_LABELS[pool]} · {data.rated[pool]} rated {data.rated[pool] === 1 ? "game" : "games"}
              </span>
              <span className="figure" data-testid={`rating-${pool}`}>
                {data.ratings[pool] ?? "—"}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <span className="label">
          Record · <span data-testid="stat-played">{overall.played}</span> {overall.played === 1 ? "game" : "games"}
        </span>
        <div className="cells">
          {figures.map(([label, value, id]) => (
            <div key={id}>
              <span className="label">{label}</span>
              <span className="figure" data-testid={`stat-${id}`}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </section>
      {overall.played > 0 && (
        <>
          <Breakdown label="By model" lines={byModel} />
          <Breakdown label="By time control" lines={byTimeControl} />
          <Breakdown label="By colour" lines={byColor} />
        </>
      )}
      <section className="section">
        <span className="label">Games</span>
        <History games={data.games} />
      </section>
      <div className="actions">
        <button className="btn ghost" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </>
  );
}
