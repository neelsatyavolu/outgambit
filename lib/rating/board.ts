import { findTimeControl } from "../config";
import type { Queryable } from "../db/client";
import { listModelRatings } from "../db/ratings";
import { EFFORTS, type Effort, type Provider } from "../game/types";
import type { OfferedModel } from "../owner/catalog";
import { POOLS, type Pool } from "./elo";
import { modelKey, seedRating } from "./seeds";

/** One line of the ratings table: a model, at one effort, in one pool. */
export type RatedModel = {
  provider: Provider;
  id: string;
  label: string;
  effort: Effort | null;
  pool: Pool;
  rating: number;
  /** Rated games behind the number. Zero means it is still the starting estimate. */
  games: number;
};

const playsBullet = (model: OfferedModel): boolean => model.timeControls.some((id) => findTimeControl(id)?.fastOnly);
const playsRegular = (model: OfferedModel): boolean => model.timeControls.some((id) => !findTimeControl(id)?.fastOnly);

/**
 * Every offered model's rating, for each effort it has and each pool it can
 * play in: the rating it has earned, or its starting estimate if it has not
 * played yet. Strongest first within each pool.
 */
export async function modelBoard(q: Queryable, models: readonly OfferedModel[]): Promise<RatedModel[]> {
  const earned = await listModelRatings(q);
  const lines = models.flatMap((model) => {
    const efforts: Array<Effort | null> = model.supportsEffort ? [...EFFORTS] : [null];
    const pools = POOLS.filter((pool) => (pool === "bullet" ? playsBullet(model) : playsRegular(model)));
    return efforts.flatMap((effort) =>
      pools.map((pool): RatedModel => {
        const row = earned.find((r) => r.key === modelKey(model.provider, model.id, effort) && r.pool === pool);
        return {
          provider: model.provider,
          id: model.id,
          label: model.label,
          effort,
          pool,
          rating: row?.rating ?? seedRating(model.provider, model.id, effort, pool),
          games: row?.games ?? 0,
        };
      }),
    );
  });
  return [...lines].sort((a, b) => POOLS.indexOf(a.pool) - POOLS.indexOf(b.pool) || b.rating - a.rating);
}
