"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { reasonText } from "@/lib/format";
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
  moves: number;
  createdAt: number;
};

const REFRESH_MS = 5_000;

function outcome(game: Summary): string {
  if (game.status === "active") return "live";
  if (game.status === "aborted") return "aborted";
  if (game.result === "draw") return `draw · ${reasonText(game.reason!)}`;
  const winner = game.result === game.playerColor ? "player won" : "ai won";
  return `${winner} · ${reasonText(game.reason!)}`;
}

export function Games() {
  const [games, setGames] = useState<Summary[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const response = await api<Summary[]>("/api/owner/games");
      if (alive && response.success) setGames(response.data);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!games) return <p className="muted">Loading…</p>;
  if (games.length === 0) return <p className="muted">No games have been played yet.</p>;
  return (
    <div className="rows">
      {games.map((game) => (
        <Link className="row" key={game.id} href={`/owner/games/${game.id}`}>
          <span className={`dot ${game.status === "active" ? "live" : ""}`} />
          <span className="grow">
            {game.modelLabel}
            <span className="meta" style={{ marginLeft: 12 }}>
              {[game.effort, game.timeControl, `player is ${game.playerColor}`].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="meta num">{game.moves} plies</span>
          <span className="meta">{outcome(game)}</span>
          <span className="meta num">{game.day}</span>
        </Link>
      ))}
    </div>
  );
}
