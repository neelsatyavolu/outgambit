import type { Provider } from "../game/types";
import type { Queryable } from "./client";
import { fromTs, toTs } from "./time";

export type Connection = { provider: Provider; secret: string; updatedAt: number };

/** `lock` holds the row until the surrounding transaction ends. */
export async function getConnection(q: Queryable, provider: Provider, lock = false): Promise<Connection | null> {
  const rows = await q.query(
    `SELECT provider, secret, updated_at FROM connections WHERE provider = $1${lock ? " FOR UPDATE" : ""}`,
    [provider],
  );
  const row = rows[0];
  return row
    ? { provider: row.provider as Provider, secret: row.secret as string, updatedAt: fromTs(row.updated_at) }
    : null;
}

export async function putConnection(q: Queryable, provider: Provider, secret: string, now: number): Promise<void> {
  await q.query(
    `INSERT INTO connections (provider, secret, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (provider) DO UPDATE SET secret = EXCLUDED.secret, updated_at = EXCLUDED.updated_at`,
    [provider, secret, toTs(now)],
  );
}

export async function deleteConnection(q: Queryable, provider: Provider): Promise<void> {
  await q.query("DELETE FROM connections WHERE provider = $1", [provider]);
}

export async function listConnections(q: Queryable): Promise<Array<{ provider: Provider; updatedAt: number }>> {
  const rows = await q.query("SELECT provider, updated_at FROM connections ORDER BY provider");
  return rows.map((r) => ({ provider: r.provider as Provider, updatedAt: fromTs(r.updated_at) }));
}
