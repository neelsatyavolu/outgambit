import { cookies } from "next/headers";
import { ACCOUNT_COOKIE, accountPlayerId } from "@/lib/account/session";
import { summarise } from "@/lib/account/stats";
import { getDb } from "@/lib/db/client";
import { expireOverdue, listGamesFor, tallyFor } from "@/lib/db/games";
import { getUser } from "@/lib/db/users";
import { fail, ok } from "@/lib/http";
import { settleRatings } from "@/lib/rating/settle";
import { accountId } from "@/lib/server/context";

const SHOWN = 100;

export async function GET() {
  const id = await accountId();
  if (!id) return fail("Sign in first.", 401);
  const db = await getDb();
  // Close out games that ran out of time with nobody watching, and rate anything newly finished.
  await expireOverdue(db, Date.now());
  await settleRatings(db);
  const user = await getUser(db, id);
  if (!user) {
    (await cookies()).delete(ACCOUNT_COOKIE);
    return fail("Sign in first.", 401);
  }
  const player = accountPlayerId(id);
  const [tallies, games] = await Promise.all([tallyFor(db, player), listGamesFor(db, player, SHOWN)]);
  return ok({
    email: user.email,
    level: user.level,
    ratings: user.ratings,
    /** Rated games played in each pool. */
    rated: user.games,
    needsSkill: user.ratings.regular === null || user.ratings.bullet === null,
    stats: summarise(tallies),
    games: games.map((g) => ({
      id: g.id,
      day: g.day,
      modelLabel: g.modelLabel,
      effort: g.effort,
      timeControl: g.timeControl,
      playerColor: g.playerColor,
      status: g.status,
      result: g.result,
      reason: g.reason,
      rating: g.rating,
    })),
  });
}
