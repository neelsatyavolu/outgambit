import { TIME_CONTROLS } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { activeGameFor, expireOverdue } from "@/lib/db/games";
import { capacity } from "@/lib/game/limits";
import { ok } from "@/lib/http";
import { listOffered } from "@/lib/owner/catalog";
import { getUser } from "@/lib/db/users";
import { modelBoard } from "@/lib/rating/board";
import { settleRatings } from "@/lib/rating/settle";
import { accountId, ipHashOf, playerId } from "@/lib/server/context";

export async function GET(request: Request) {
  const db = await getDb();
  const player = (await playerId({ create: true }))!;
  // Close out games that ran out of time with nobody watching, before reporting on them.
  await expireOverdue(db, Date.now());
  await settleRatings(db);
  const userId = await accountId();
  const [limits, models, active, user] = await Promise.all([
    capacity(db, player, ipHashOf(request), Date.now()),
    listOffered(db),
    activeGameFor(db, player),
    userId ? getUser(db, userId) : null,
  ]);
  return ok({
    capacity: limits,
    models,
    /** Every offered model's rating, at each effort and in each pool it can play. */
    ratings: await modelBoard(db, models),
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
