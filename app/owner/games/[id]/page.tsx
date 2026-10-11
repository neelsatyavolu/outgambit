import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GameClient } from "@/components/GameClient";
import { getGameView } from "@/lib/game/state";
import { buildDeps, isOwner } from "@/lib/server/context";

export const metadata: Metadata = { title: "Watching · Gambit", robots: { index: false } };

// Opening the page may restart a slow model's turn, which then runs inside this limit.
export const maxDuration = 300;

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) redirect("/owner");
  const { id } = await params;
  const initial = await getGameView(await buildDeps(), id, { owner: true });
  return <GameClient id={id} spectator initial={initial} />;
}
