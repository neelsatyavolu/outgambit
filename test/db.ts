import { randomUUID } from "node:crypto";
import { createPgliteDb, createPostgresDb, type Db } from "@/lib/db/client";
import { migrate } from "@/lib/db/schema";

/**
 * A fresh, migrated database for one test file. In-process by default; set
 * TEST_DATABASE_URL to run the same tests against a real Postgres server,
 * where each file gets its own schema.
 */
export async function testDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  const db = url ? await isolatedSchema(url) : await createPgliteDb();
  await migrate(db);
  return db;
}

async function isolatedSchema(url: string): Promise<Db> {
  const schema = `t_${randomUUID().replaceAll("-", "")}`;
  await (await createPostgresDb(url)).query(`CREATE SCHEMA ${schema}`);
  return createPostgresDb(url, schema);
}

export async function resetDb(db: Db): Promise<void> {
  await db.query("TRUNCATE games, moves, connections, models, rate_limits, users, model_ratings, settings, usage, password_resets");
}

/**
 * The same database, but pausing after any query inside a transaction that
 * matches `pattern`. Holding a transaction open between its read and its
 * write is what makes a missing lock show up as a failed test on a real
 * server, where two fast transactions would otherwise rarely overlap.
 */
export function pausingAfter(db: Db, pattern: RegExp, ms = 40): Db {
  return {
    query: db.query,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async (sql, params) => {
            const rows = await tx.query(sql, params);
            if (pattern.test(sql)) await new Promise((resolve) => setTimeout(resolve, ms));
            return rows;
          },
        } as typeof tx),
      ),
  };
}
