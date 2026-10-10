import { TIME_CONTROLS } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { activeGameFor, expireOverdue } from "@/lib/db/games";
import { capacity } from "@/lib/game/limits";
import { ok } from "@/lib/http";
import { listOffered } from "@/lib/owner/catalog";
import { ipHashOf, playerId } from "@/lib/server/context";

export async function GET(request: Request) {
  const db = await getDb();
  const player = (await playerId({ create: true }))!;
  // Close out games that ran out of time with nobody watching, before reporting on them.
  await expireOverdue(db, Date.now());
  const [limits, models, active] = await Promise.all([
    capacity(db, player, ipHashOf(request), Date.now()),
    listOffered(db),
    activeGameFor(db, player),
  ]);
  return ok({ capacity: limits, models, timeControls: TIME_CONTROLS, activeGameId: active?.id ?? null });
}
