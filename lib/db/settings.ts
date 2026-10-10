import type { Queryable } from "./client";

/** A value the owner has set, or null if it has never been set. */
export async function getSetting(q: Queryable, key: string): Promise<string | null> {
  const rows = await q.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(q: Queryable, key: string, value: string): Promise<void> {
  await q.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}
