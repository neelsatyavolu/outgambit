import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/client";
import { deleteExpiredResets, deleteResetsFor, insertReset, takeReset } from "../db/password-resets";
import { replacePassword } from "../db/users";
import { hashPassword } from "./password";

export const RESET_TTL_MS = 60 * 60_000;
const TOKEN_BYTES = 32;

// The token is random and long, so a plain hash is enough to keep a copy of the table from being usable.
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * Makes the token for a reset link, good for an hour, in place of any the
 * account was sent before. Only the token's hash is kept: the link exists
 * in the email alone.
 */
export async function issueReset(db: Db, userId: string, now: number): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await db.transaction(async (tx) => {
    await deleteExpiredResets(tx, now);
    await deleteResetsFor(tx, userId);
    await insertReset(tx, { tokenHash: hashToken(token), userId, expiresAt: now + RESET_TTL_MS, createdAt: now });
  });
  return token;
}

/**
 * Sets a new password for the account a reset token was sent to, and ends
 * every session it had. The account's id, or null when the token is unknown,
 * used or expired.
 */
export async function resetPassword(db: Db, input: { token: string; password: string; now: number }): Promise<string | null> {
  const passwordHash = await hashPassword(input.password);
  // One transaction, so a failure cannot use the link up and leave the old password in place.
  return db.transaction(async (tx) => {
    const userId = await takeReset(tx, hashToken(input.token), input.now);
    if (!userId) return null;
    await replacePassword(tx, userId, passwordHash);
    await deleteResetsFor(tx, userId);
    return userId;
  });
}
