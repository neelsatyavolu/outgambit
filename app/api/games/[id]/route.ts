import { getGameView } from "@/lib/game/state";
import { fail, ok } from "@/lib/http";
import { buildDeps, isOwner, playerId } from "@/lib/server/context";

// A poll may restart a slow model's turn, which then runs inside this limit.
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deps = await buildDeps();
  const viewer = { playerId: await playerId({ create: false }), owner: await isOwner() };
  const view = await getGameView(deps, id, viewer);
  return view ? ok(view) : fail("Game not found.", 404);
}
