import { z } from "zod";
import { setArenaGamesPerDay, startArenaGame, type StartRefusal } from "@/lib/arena/run";
import { arenaOrigin, runAndHandOver } from "@/lib/arena/schedule";
import { arenaStatus } from "@/lib/arena/status";
import { ARENA } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { PROVIDERS } from "@/lib/game/types";
import { fail, ok, readBody } from "@/lib/http";
import { setModelArena } from "@/lib/owner/admin";
import { buildDeps, refuseUnlessOwner } from "@/lib/server/context";

// A game started by hand is played after the response, like a scheduled one.
export const maxDuration = 800;

const changeSchema = z.union([
  z.object({ gamesPerDay: z.number().int().min(0).max(ARENA.maxGamesPerDay) }),
  z.object({ provider: z.enum(PROVIDERS), id: z.string().trim().min(1).max(200), arena: z.boolean() }),
]);

const REFUSALS: Record<StartRefusal, string> = {
  running: "An arena game is already being played.",
  budget: "Today's arena games have all been played.",
  no_pairing: "The arena needs at least two models that can play the same time control.",
};

export async function GET(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  return ok(await arenaStatus(await getDb(), Date.now()));
}

/** Changes the day's budget, or puts one model in the arena or takes it out. */
export async function PATCH(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const body = await readBody(request, changeSchema);
  if (!body) return fail(`Give a number of games from 0 to ${ARENA.maxGamesPerDay}, or a model.`, 400);
  const db = await getDb();
  if ("gamesPerDay" in body) await setArenaGamesPerDay(db, body.gamesPerDay);
  else if (!(await setModelArena(db, body.provider, body.id, body.arena))) return fail("Unknown model.", 404);
  return ok(await arenaStatus(db, Date.now()));
}

/** Starts an arena game now, whatever is left of the day's budget. */
export async function POST(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const deps = await buildDeps();
  const started = await startArenaGame(deps, { ignoreBudget: true });
  if (!started.ok) return fail(REFUSALS[started.reason], 409);
  deps.schedule(() => runAndHandOver(deps, { start: false, origin: arenaOrigin(request) }));
  return ok({ gameId: started.game.id }, 201);
}
