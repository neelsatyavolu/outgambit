import type { Queryable } from "./client";

/** A value the owner has set, or null if it has never been set. */
export async function getSetting(q: Queryable, key: string): Promise<string | null> {
  const rows = await q.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

/** Every stored value whose key starts with `prefix`, by the rest of its key. */
export async function getSettings(q: Queryable, prefix: string): Promise<Map<string, string>> {
  const rows = await q.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE starts_with(key, $1)",
    [prefix],
  );
  return new Map(rows.map((row) => [row.key.slice(prefix.length), row.value]));
}

export async function setSetting(q: Queryable, key: string, value: string): Promise<void> {
  await q.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}
