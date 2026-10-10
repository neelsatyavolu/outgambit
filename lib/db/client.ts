import "server-only";
import { env } from "../env";
import { migrate } from "./schema";

export type Row = Record<string, unknown>;
export type Queryable = { query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> };
export type Db = Queryable & { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> };

const PGLITE_SCHEME = "pglite://";

/** Postgres in-process. Used by tests and by local development. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      pg.transaction((tx) =>
        fn({ query: async <R>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows }),
      ) as Promise<T>,
  };
}

export async function createNeonDb(url: string): Promise<Db> {
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url });
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[],
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function open(url: string): Promise<Db> {
  const db = url.startsWith(PGLITE_SCHEME)
    ? await createPgliteDb(url === `${PGLITE_SCHEME}memory` ? undefined : url.slice(PGLITE_SCHEME.length))
    : await createNeonDb(url);
  await migrate(db);
  return db;
}

// Kept on globalThis so dev-server reloads reuse the one connection.
const holder = globalThis as typeof globalThis & { __gambitDb?: Promise<Db> };

/** The process-wide database, migrated on first use. */
export function getDb(): Promise<Db> {
  holder.__gambitDb ??= open(env().DATABASE_URL).catch((error) => {
    holder.__gambitDb = undefined;
    throw error;
  });
  return holder.__gambitDb;
}
