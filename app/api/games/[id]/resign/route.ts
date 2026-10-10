import { resign } from "@/lib/game/move";
import { fail, ok, sameOrigin } from "@/lib/http";
import { buildDeps, playerId } from "@/lib/server/context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const { id } = await params;
  const player = await playerId({ create: false });
  const deps = await buildDeps();
  const resigned = player ? await resign(deps, id, player) : false;
  return resigned ? ok({ resigned: true }) : fail("There is no game in progress to resign.", 409);
}
