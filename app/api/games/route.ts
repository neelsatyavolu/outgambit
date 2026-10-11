import { z } from "zod";
import { BLOCKED_TEXT } from "@/lib/budget/text";
import { hitRateLimit } from "@/lib/db/rate-limit";
import { createGame, type CreateError } from "@/lib/game/create";
import { EFFORTS, PROVIDERS } from "@/lib/game/types";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { accountPlayerId } from "@/lib/account/session";
import { getUser } from "@/lib/db/users";
import { accountId, buildDeps, ipHashOf } from "@/lib/server/context";

// A slow model's first move runs after the response, inside this limit.
export const maxDuration = 300;

const schema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().min(1).max(200),
  effort: z.enum(EFFORTS).nullish(),
  timeControl: z.string().min(3).max(10),
  color: z.enum(["white", "black", "random"]),
});

const REFUSALS: Record<CreateError, { message: string; status: number }> = {
  unknown_model: { message: "That opponent is not available.", status: 400 },
  bad_time_control: { message: "That time control is not available for this opponent.", status: 400 },
  active_game: { message: "You already have a game in progress.", status: 409 },
  no_games_left: { message: "This opponent has no games left today.", status: 429 },
};

const CREATES_PER_MINUTE = 10;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const body = await readBody(request, schema);
  if (!body) return fail("Choose an opponent, a time control and a color.", 400);
  // Games are rated, so each one needs an account with a starting rating.
  const userId = await accountId();
  if (!userId) return fail("Create an account or sign in to play.", 401);
  const deps = await buildDeps();
  const user = await getUser(deps.db, userId);
  if (!user) return fail("Create an account or sign in to play.", 401);
  if (user.ratings.regular === null || user.ratings.bullet === null) {
    return fail("Tell us how strong you are first, on your account page.", 409);
  }
  const ipHash = ipHashOf(request);
  if (!(await hitRateLimit(deps.db, `create:${ipHash}`, CREATES_PER_MINUTE, 60_000, deps.now()))) {
    return fail("Too many attempts. Wait a minute and try again.", 429);
  }
  const created = await createGame(deps, {
    playerId: accountPlayerId(userId),
    ipHash,
    provider: body.provider,
    model: body.model,
    effort: body.effort ?? null,
    timeControl: body.timeControl,
    color: body.color,
  });
  if (!created.ok) {
    const refusal = REFUSALS[created.error];
    return fail(created.blocked ? BLOCKED_TEXT[created.blocked] : refusal.message, refusal.status);
  }
  return ok({ id: created.game.id }, 201);
}
