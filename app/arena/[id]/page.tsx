import type { Metadata } from "next";
import { GameClient } from "@/components/GameClient";

export const metadata: Metadata = { title: "Arena game · Gambit" };

export default async function ArenaGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameClient id={id} spectator />;
}
