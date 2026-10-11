import { GameClient } from "@/components/GameClient";
import { getGameView } from "@/lib/game/state";
import { buildDeps, isOwner, playerId } from "@/lib/server/context";

// Opening the page may restart a slow model's turn, which then runs inside this limit.
export const maxDuration = 300;

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The game comes with the page, so the board is drawn without waiting for a first request.
  const viewer = { playerId: await playerId({ create: false }), owner: await isOwner() };
  const initial = await getGameView(await buildDeps(), id, viewer);
  return <GameClient id={id} spectator={false} initial={initial} />;
}
