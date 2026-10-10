import { createPgliteDb, type Db } from "@/lib/db/client";
import { migrate } from "@/lib/db/schema";

export async function testDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  return db;
}

export async function resetDb(db: Db): Promise<void> {
  await db.query("TRUNCATE games, moves, connections, models, rate_limits");
}
