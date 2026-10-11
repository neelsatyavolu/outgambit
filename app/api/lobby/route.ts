import { allowances } from "@/lib/budget/allowance";
import { usageSource } from "@/lib/budget/sources";
import { TIME_CONTROLS } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { activeGameFor, expireOverdue } from "@/lib/db/games";
import { nextResetAt } from "@/lib/game/limits";
import { ok } from "@/lib/http";
import { listOffered } from "@/lib/owner/catalog";
import { getUser } from "@/lib/db/users";
import { modelBoard } from "@/lib/rating/board";
import { settleRatings } from "@/lib/rating/settle";
import { ipHashOf, visitor } from "@/lib/server/context";

export async function GET(request: Request) {
  const db = await getDb();
  const now = Date.now();
  // Close out games that ran out of time with nobody watching, before reporting on them.
  const swept = expireOverdue(db, now).then(() => settleRatings(db));
  // Nothing here waits on anything else here, so none of it waits its turn.
  const [who, models] = await Promise.all([visitor({ create: true }), listOffered(db), swept]);
  const player = who.playerId!;
  const [budgets, active, user, ratings] = await Promise.all([
    allowances(db, usageSource(db), models, { playerId: player, ipHash: ipHashOf(request) }, now),
    activeGameFor(db, player),
    who.userId ? getUser(db, who.userId) : null,
    modelBoard(db, models),
  ]);
  return ok({
    models,
    /** What this visitor may still play against each model today, by "provider/id". Null where there is no limit. */
    budgets,
    /** When the day's budgets start again: the next Pacific midnight. */
    resetAt: nextResetAt(now),
    /** Every offered model's rating, at each effort and in each pool it can play. */
    ratings,
    timeControls: TIME_CONTROLS,
    activeGameId: active?.id ?? null,
    /** Null for a visitor who is not signed in; they must be, to play. */
    account: user
      ? {
          email: user.email,
          ratings: user.ratings,
          needsSkill: user.ratings.regular === null || user.ratings.bullet === null,
        }
      : null,
  });
}
