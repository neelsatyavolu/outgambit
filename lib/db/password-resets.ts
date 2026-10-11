import type { Queryable } from "./client";
import { toTs } from "./time";

export type PasswordReset = { tokenHash: string; userId: string; expiresAt: number; createdAt: number };

export async function insertReset(q: Queryable, reset: PasswordReset): Promise<void> {
  await q.query("INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)", [
    reset.tokenHash, reset.userId, toTs(reset.expiresAt), toTs(reset.createdAt),
  ]);
}

/**
 * Uses a reset up: the account it was for, or null if there is no such reset
 * or it has expired. One statement, so a link cannot be used twice however
 * closely two requests arrive.
 */
export async function takeReset(q: Queryable, tokenHash: string, now: number): Promise<string | null> {
  const [row] = await q.query<{ user_id: string }>(
    "DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > $2 RETURNING user_id",
    [tokenHash, toTs(now)],
  );
  return row?.user_id ?? null;
}

export async function deleteResetsFor(q: Queryable, userId: string): Promise<void> {
  await q.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
}

/** Nothing else clears expired resets away, so each new request does. */
export async function deleteExpiredResets(q: Queryable, now: number): Promise<void> {
  await q.query("DELETE FROM password_resets WHERE expires_at <= $1", [toTs(now)]);
}
