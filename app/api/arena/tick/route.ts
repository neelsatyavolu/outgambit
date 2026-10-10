import { isArenaCall, arenaOrigin, runAndHandOver } from "@/lib/arena/schedule";
import { fail, ok } from "@/lib/http";
import { buildDeps } from "@/lib/server/context";

// A run plays the live arena game after the response, for most of this limit (see ARENA.runBudgetMs).
// The 800 s need Vercel's Pro plan with Fluid Compute.
export const maxDuration = 800;

/**
 * Called by the schedule to start the next arena game, and by a run that is
 * out of time to have the live game carried on (`?continue`), which never
 * starts a new one.
 */
export async function GET(request: Request) {
  if (!isArenaCall(request)) return fail("Not found.", 404);
  const start = !new URL(request.url).searchParams.has("continue");
  const deps = await buildDeps();
  deps.schedule(() => runAndHandOver(deps, { start, origin: arenaOrigin(request) }));
  return ok({ accepted: true });
}
