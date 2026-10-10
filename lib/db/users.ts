import type { Queryable, Row } from "./client";
import { fromTs, toTs } from "./time";

export type User = { id: string; email: string; passwordHash: string; createdAt: number };

function rowToUser(row: Row): User {
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    createdAt: fromTs(row.created_at),
  };
}

/** False when the email already belongs to an account. */
export async function insertUser(q: Queryable, user: User): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [user.id, user.email, user.passwordHash, toTs(user.createdAt)],
  );
  return rows.length === 1;
}

export async function findUserByEmail(q: Queryable, email: string): Promise<User | null> {
  const rows = await q.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function getUser(q: Queryable, id: string): Promise<User | null> {
  const rows = await q.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ? rowToUser(rows[0]) : null;
}
