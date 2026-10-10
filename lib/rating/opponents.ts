import type { Effort } from "../game/types";
import type { OfferedModel } from "../owner/catalog";
import type { RatedModel } from "./board";
import { POOLS, poolOf, type Pool } from "./elo";

/** A model's rating line at the chosen effort, in the given pool (or regular, if it does not play that pool). */
export function ratingFor(
  ratings: readonly RatedModel[],
  model: OfferedModel,
  effort: Effort,
  pool: Pool,
): RatedModel | undefined {
  const lines = ratings.filter(
    (r) => r.provider === model.provider && r.id === model.id && r.effort === (model.supportsEffort ? effort : null),
  );
  return lines.find((r) => r.pool === pool) ?? lines.find((r) => r.pool === "regular");
}

export type OpponentGroup = { pool: Pool; opponents: Array<{ model: OfferedModel; line: RatedModel | undefined }> };

/** The quickest pool a model plays in: bullet if it is fast enough, regular otherwise. */
const quickestPool = (model: OfferedModel): Pool =>
  model.timeControls.some((id) => poolOf(id) === "bullet") ? "bullet" : "regular";

/**
 * The opponents on offer, each listed once: those fast enough for bullet, then
 * those that only play regular games. Each group is strongest first, by its
 * rating in that group's pool at the chosen effort.
 */
export function opponentGroups(
  models: readonly OfferedModel[],
  ratings: readonly RatedModel[],
  effort: Effort,
): OpponentGroup[] {
  return POOLS.map((pool) => ({
    pool,
    opponents: models
      .filter((model) => quickestPool(model) === pool)
      .map((model) => ({ model, line: ratingFor(ratings, model, effort, pool) }))
      .sort((a, b) => (b.line?.rating ?? 0) - (a.line?.rating ?? 0)),
  })).filter((group) => group.opponents.length > 0);
}
