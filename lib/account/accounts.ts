import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import { claimGames } from "../db/games";
import { findUserByEmail, insertUser, sessionVersionOf, setSkill, type SkillRecord } from "../db/users";
import { startingRatings, type Skill } from "../rating/elo";
import { hashPassword, verifyPassword } from "./password";
import { accountPlayerId, accountSessionOf } from "./session";

/** `guestId` is the anonymous id this browser has been playing under, if it has one. */
type Credentials = { email: string; password: string; guestId: string | undefined };

const normalise = (email: string): string => email.trim().toLowerCase();

const record = (skill: Skill): SkillRecord => ({
  level: skill.kind === "level" ? skill.level : null,
  ratings: startingRatings(skill),
});

/** Sets where a player's ratings start. False once they have a rated game. */
export function chooseSkill(q: Queryable, userId: string, skill: Skill): Promise<boolean> {
  return setSkill(q, userId, record(skill));
}

/** Creates an account and gives it this browser's games. Null when the email is taken. */
export async function register(db: Db, input: Credentials & { now: number; skill: Skill }): Promise<string | null> {
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  // One transaction, so a failure cannot leave an account that took its email but not its games.
  return db.transaction(async (tx) => {
    const user = { id, email: normalise(input.email), passwordHash, createdAt: input.now };
    const created = await insertUser(tx, user, record(input.skill));
    if (!created) return null;
    if (input.guestId) await claimGames(tx, input.guestId, accountPlayerId(id));
    return id;
  });
}

/** The account's id when the password is right, with this browser's games moved to it. */
export async function signIn(q: Queryable, input: Credentials): Promise<string | null> {
  const user = await findUserByEmail(q, normalise(input.email));
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) return null;
  if (input.guestId) await claimGames(q, input.guestId, accountPlayerId(user.id));
  return user.id;
}

/**
 * The account a session is for, or null. A session is a signed token and
 * would outlive what it was for, so it is checked against the account: it is
 * nobody's once the account is gone, or has ended its sessions (a password
 * reset) since this one was made. One read, by primary key.
 */
export async function accountIn(q: Queryable, token: string | undefined, now: number): Promise<string | null> {
  const session = accountSessionOf(token, now);
  if (!session) return null;
  return (await sessionVersionOf(q, session.userId)) === session.version ? session.userId : null;
}
