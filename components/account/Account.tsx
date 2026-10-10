"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { winRate, type Line, type Stats, type Tally } from "@/lib/account/stats";
import { api } from "@/lib/client/api";
import { outcomeText } from "@/lib/format";
import type { Color, Effort, Reason, Result, Status } from "@/lib/game/types";

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
};

type AccountData = { email: string; stats: Stats; games: Summary[] };

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
  }, [router]);

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
