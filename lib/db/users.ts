import type { Pool } from "../rating/elo";
import type { Queryable, Row } from "./client";
import { fromTs, toTs } from "./time";

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  /** The level the player chose at sign-up, or null if they gave chess.com ratings (or nothing yet). */
  level: string | null;
  /** Null until the player has said how strong they are. */
  ratings: Record<Pool, number | null>;
  /** Rated games played in each pool. */
  games: Record<Pool, number>;
};

export type NewUser = Pick<User, "id" | "email" | "passwordHash" | "createdAt">;
export type SkillRecord = { level: string | null; ratings: Record<Pool, number> };

function rowToUser(row: Row): User {
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    createdAt: fromTs(row.created_at),
    level: (row.level as string | null) ?? null,
    ratings: {
      bullet: (row.bullet_rating as number | null) ?? null,
      regular: (row.regular_rating as number | null) ?? null,
    },
    games: { bullet: row.bullet_games as number, regular: row.regular_games as number },
  };
}

/** False when the email already belongs to an account. */
export async function insertUser(q: Queryable, user: NewUser, skill?: SkillRecord): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO users (id, email, password_hash, created_at, level, bullet_rating, regular_rating)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [
      user.id, user.email, user.passwordHash, toTs(user.createdAt),
      skill?.level ?? null, skill?.ratings.bullet ?? null, skill?.ratings.regular ?? null,
    ],
  );
  return rows.length === 1;
}

export async function findUserByEmail(q: Queryable, email: string): Promise<User | null> {
  const rows = await q.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

/** `lock` holds the row until the surrounding transaction ends. */
export async function getUser(q: Queryable, id: string, lock = false): Promise<User | null> {
  const rows = await q.query(`SELECT * FROM users WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

/**
 * Sets a player's starting ratings. Only possible before their first rated
 * game: after that, ratings change by playing, not by editing.
 */
export async function setSkill(q: Queryable, id: string, skill: SkillRecord): Promise<boolean> {
  const rows = await q.query(
    `UPDATE users SET level = $2, bullet_rating = $3, regular_rating = $4
      WHERE id = $1 AND bullet_games + regular_games = 0 RETURNING id`,
    [id, skill.level, skill.ratings.bullet, skill.ratings.regular],
  );
  return rows.length === 1;
}

/** Records a rated game: the player's new rating in that pool, and one more game played. */
export async function applyPlayerRating(q: Queryable, id: string, pool: Pool, rating: number): Promise<void> {
  // The column names come from a fixed two-value type, never from input.
  await q.query(`UPDATE users SET ${pool}_rating = $2, ${pool}_games = ${pool}_games + 1 WHERE id = $1`, [id, rating]);
}
