import type { Queryable } from "./client";
import { toTs } from "./time";

/**
 * Counts one hit against `key` in a fixed window. Returns false once the
 * limit for the current window has been passed.
 */
export async function hitRateLimit(
  q: Queryable,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<boolean> {
  const [row] = await q.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2::timestamptz, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= $3::timestamptz THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= $3::timestamptz THEN $2::timestamptz
                           ELSE rate_limits.window_start END
     RETURNING count`,
    [key, toTs(now), toTs(now - windowMs)],
  );
  return row.count <= limit;
}
