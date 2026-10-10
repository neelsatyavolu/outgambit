import { getDb } from "@/lib/db/client";
import { listGames } from "@/lib/db/games";
import { ok } from "@/lib/http";
import { refuseUnlessOwner } from "@/lib/server/context";

const SHOWN = 100;

export async function GET(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const games = await listGames(await getDb(), SHOWN);
  return ok(
    games.map((g) => ({
      id: g.id,
      day: g.day,
      modelLabel: g.modelLabel,
      effort: g.effort,
      timeControl: g.timeControl,
      playerColor: g.playerColor,
      status: g.status,
      result: g.result,
      reason: g.reason,
      moves: g.ply,
      createdAt: g.createdAt,
    })),
  );
}
