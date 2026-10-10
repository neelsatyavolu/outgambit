import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GameClient } from "@/components/GameClient";
import { isOwner } from "@/lib/server/context";

export const metadata: Metadata = { title: "Watching · Gambit", robots: { index: false } };

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) redirect("/owner");
  const { id } = await params;
  return <GameClient id={id} spectator />;
}
