import { userIdOf } from "../account/session";
import type { Db } from "../db/client";
import { listUnrated, lockUnrated, markRated } from "../db/games";
import { applyModelRating, ensureModelRating, lockModelRating } from "../db/ratings";
import { applyPlayerRating, getUser } from "../db/users";
import type { Game } from "../game/types";
import { poolOf, rate } from "./elo";
import { modelKey, seedRating } from "./seeds";

const BATCH = 25;
/** For an account that somehow has no starting rating: the middle of the scale. */
const UNKNOWN_PLAYER = 1000;

const scoreOf = (game: Game): 0 | 0.5 | 1 => (game.result === "draw" ? 0.5 : game.result === game.playerColor ? 1 : 0);

/** Rates one game inside a transaction. False if someone else already had. */
async function settleOne(db: Db, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Rows are always locked in the same order (game, player, model), so two
    // settlements can wait on each other but never deadlock.
    const game = await lockUnrated(tx, id);
    if (!game) return false;
    const userId = userIdOf(game.playerId);
    const user = userId ? await getUser(tx, userId, true) : null;
    if (!user) {
      // A game from before accounts were required: close it out, rating nobody.
      await markRated(tx, id, null);
      return false;
    }
    const pool = poolOf(game.timeControl);
    const key = modelKey(game.provider, game.model, game.effort);
    await ensureModelRating(tx, key, pool, seedRating(game.provider, game.model, game.effort, pool));
    const model = (await lockModelRating(tx, key, pool))!;
    const playerBefore = user.ratings[pool] ?? UNKNOWN_PLAYER;
    const next = rate({
      player: playerBefore,
      model: model.rating,
      score: scoreOf(game),
      playerGames: user.games[pool],
      modelGames: model.games,
    });
    await applyPlayerRating(tx, user.id, pool, next.player);
    await applyModelRating(tx, key, pool, next.model);
    await markRated(tx, id, { playerBefore, playerAfter: next.player, aiBefore: model.rating, aiAfter: next.model });
    return true;
  });
}

/**
 * Applies every finished, not-yet-rated game to the ratings, oldest first.
 * Games end in several places (a move, a flag, a resignation, the sweep of
 * abandoned games), so rating happens here, afterwards, in one place. Safe to
 * call as often as you like. Returns how many games were rated.
 */
export async function settleRatings(db: Db): Promise<number> {
  let rated = 0;
  for (const id of await listUnrated(db, BATCH)) {
    if (await settleOne(db, id)) rated += 1;
  }
  return rated;
}
