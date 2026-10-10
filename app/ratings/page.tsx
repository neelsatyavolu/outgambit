import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { expireOverdue } from "@/lib/db/games";
import { PROVIDER_LABELS } from "@/lib/format";
import { listOffered } from "@/lib/owner/catalog";
import { modelBoard, type RatedModel } from "@/lib/rating/board";
import { POOLS, POOL_LABELS } from "@/lib/rating/elo";
import { settleRatings } from "@/lib/rating/settle";

export const metadata: Metadata = { title: "Ratings · Gambit" };
// Ratings change with every game, so this page is never prerendered.
export const dynamic = "force-dynamic";

function Table({ lines }: { lines: RatedModel[] }) {
  if (lines.length === 0) return <p className="muted">No models play in this pool yet.</p>;
  return (
    <table className="ratings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Model</th>
          <th className="num">Rating</th>
          <th className="num">Games</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => (
          <tr key={`${line.provider}/${line.id}/${line.effort}`}>
            <td className="num muted">{i + 1}</td>
            <td>
              {line.label}
              <span className="meta" style={{ marginLeft: 10 }}>
                {[PROVIDER_LABELS[line.provider], line.effort ? `${line.effort} effort` : null].filter(Boolean).join(" · ")}
              </span>
            </td>
            <td className="num">
              {line.games === 0 ? "~" : ""}
              {line.rating}
            </td>
            <td className="num muted">{line.games}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Closes out and rates anything that has finished, then reads the table. */
async function loadBoard(): Promise<RatedModel[]> {
  const db = await getDb();
  await expireOverdue(db, Date.now());
  await settleRatings(db);
  return modelBoard(db, await listOffered(db));
}

export default async function RatingsPage() {
  const board = await loadBoard();
  return (
    <>
      <h1 className="display">Ratings</h1>
      <p className="lede">
        Every game is rated, for the player and for the model, and the models also play each other in the{" "}
        <Link href="/arena">arena</Link>. A model starts at an estimate, marked ~, and moves with each result. Quick
        games and slow games are rated separately.
      </p>
      <div className="two-up">
        {POOLS.map((pool) => (
          <section className="section" key={pool}>
            <span className="label">
              {POOL_LABELS[pool]} · {pool === "bullet" ? "1+0 to 5+0" : "10+10 and slower"}
            </span>
            <Table lines={board.filter((line) => line.pool === pool)} />
          </section>
        ))}
      </div>
    </>
  );
}
