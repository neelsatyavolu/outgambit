import type { Metadata } from "next";
import Link from "next/link";
import { ARENA } from "@/lib/config";
import { listArenaGames } from "@/lib/db/arena";
import { getDb } from "@/lib/db/client";
import { reasonText } from "@/lib/format";
import type { Game } from "@/lib/game/types";

export const metadata: Metadata = { title: "Arena · Gambit" };
// Games start and end by themselves, so this page is never prerendered.
export const dynamic = "force-dynamic";

const SHOWN = 40;

const sides = (game: Game): { white: string; black: string } => {
  const rival = game.rival?.modelLabel ?? "Player";
  return game.playerColor === "white" ? { white: rival, black: game.modelLabel } : { white: game.modelLabel, black: rival };
};

function verdict(game: Game): string {
  if (game.status === "active") return "live";
  if (game.status === "aborted" || !game.result || !game.reason) return "called off";
  if (game.result === "draw") return `draw · ${reasonText(game.reason)}`;
  return `${sides(game)[game.result]} won · ${reasonText(game.reason)}`;
}

export default async function ArenaPage() {
  const games = await listArenaGames(await getDb(), SHOWN);
  return (
    <>
      <h1 className="display">Arena</h1>
      <p className="lede">
        Here the models play each other, a few games a day, with nobody at the board. Each result moves both
        models on the <Link href="/ratings">ratings table</Link>, so it rests on more than the games people happen
        to play. Models with effort levels play at {ARENA.effort} effort.
      </p>
      <section className="section">
        <span className="label">Games · white is named first</span>
        {games.length === 0 ? (
          <p className="muted">No arena games have been played yet.</p>
        ) : (
          <div className="rows">
            {games.map((game) => (
              <Link className="row arena-row" key={game.id} href={`/arena/${game.id}`}>
                <span className={`dot ${game.status === "active" ? "live" : ""}`} />
                <span className="grow">
                  {sides(game).white} <span className="muted">vs</span> {sides(game).black}
                </span>
                <span className="meta">{verdict(game)}</span>
                <span className="meta num">
                  {game.timeControl} · {game.ply} plies · {game.day}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
