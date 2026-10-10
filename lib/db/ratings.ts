import type { Pool } from "../rating/elo";
import type { Queryable } from "./client";

export type ModelRating = { key: string; pool: Pool; rating: number; games: number };

/** Creates a model's rating at its starting estimate, unless it already has one. */
export async function ensureModelRating(q: Queryable, key: string, pool: Pool, seed: number): Promise<void> {
  await q.query(
    "INSERT INTO model_ratings (key, pool, rating, games) VALUES ($1, $2, $3, 0) ON CONFLICT (key, pool) DO NOTHING",
    [key, pool, seed],
  );
}

/** Reads a model's rating and holds the row until the surrounding transaction ends. */
export async function lockModelRating(q: Queryable, key: string, pool: Pool): Promise<ModelRating | null> {
  const rows = await q.query<ModelRating>(
    "SELECT key, pool, rating, games FROM model_ratings WHERE key = $1 AND pool = $2 FOR UPDATE",
    [key, pool],
  );
  return rows[0] ?? null;
}

export async function applyModelRating(q: Queryable, key: string, pool: Pool, rating: number): Promise<void> {
  await q.query("UPDATE model_ratings SET rating = $3, games = games + 1 WHERE key = $1 AND pool = $2", [
    key, pool, rating,
  ]);
}

export async function listModelRatings(q: Queryable): Promise<ModelRating[]> {
  return q.query<ModelRating>("SELECT key, pool, rating, games FROM model_ratings ORDER BY key, pool");
}
