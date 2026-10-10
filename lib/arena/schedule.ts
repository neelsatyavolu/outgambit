import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ARENA } from "../config";
import type { Deps } from "../game/deps";
import { runArena } from "./run";

const RUN_PATH = "/api/arena/tick";
const bearer = (secret: string): string => `Bearer ${secret}`;

/** The secret Vercel's cron sends with each scheduled call. Without one the arena has no schedule. */
export const cronSecret = (): string | undefined => process.env.CRON_SECRET || undefined;

/** Whether a request carries the schedule's secret, as Vercel's cron and the arena's own hand-overs do. */
export function isArenaCall(request: Request): boolean {
  const secret = cronSecret();
  const given = request.headers.get("authorization");
  if (!secret || !given) return false;
  const [a, b] = [Buffer.from(given), Buffer.from(bearer(secret))];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The address runs are asked for at: the production site when deployed, otherwise wherever this request came in. */
export function arenaOrigin(request: Request): string {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : new URL(request.url).origin;
}

/**
 * Asks the site for another run. The answer comes back as soon as that run
 * has begun, so this does not wait for it to finish. Without a secret there
 * is nobody to ask, and the game waits for the next start by hand.
 */
async function requestRun(origin: string): Promise<void> {
  const secret = cronSecret();
  if (!secret) return;
  const response = await fetch(`${origin}${RUN_PATH}?continue=1`, {
    headers: { authorization: bearer(secret) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`the next arena run was refused with HTTP ${response.status}`);
}

/**
 * One run of the arena, as a background job. A function can only work for so
 * long, so a game that outlasts this run is handed to a fresh one. If the
 * hand-over fails, the next scheduled run picks the game up; its clocks stand
 * still in between, so nothing is lost but time.
 */
export async function runAndHandOver(deps: Deps, options: { start: boolean; origin: string }): Promise<void> {
  const run = await runArena(deps, { start: options.start, deadline: deps.now() + ARENA.runBudgetMs });
  if (run.state === "out_of_time") await requestRun(options.origin);
}
