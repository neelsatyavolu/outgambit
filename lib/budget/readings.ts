import { errorName } from "../ai/result";
import { BUDGET } from "../config";
import type { Queryable } from "../db/client";
import { getSetting, setSetting } from "../db/settings";

/**
 * A figure read from a provider. `value` is null when there is no reading
 * recent enough to trust; `error` is what went wrong on the last try, if it failed.
 */
export type Reading<T> = { value: T | null; readAt: number | null; error: string | null };

type Stored<T> = Reading<T> & { triedAt: number };

const KEY = "reading:";

/**
 * The provider's figure called `name`, read again only when the stored one
 * has aged. A failed read keeps the last good figure for a while, so one bad
 * minute at the provider does not close a budget. `load` resolves to the
 * figure, or to a few words saying why it could not be read.
 */
export async function reading<T extends object>(
  q: Queryable,
  name: string,
  now: number,
  load: () => Promise<T | string>,
): Promise<Reading<T>> {
  const raw = await getSetting(q, KEY + name);
  let stored = raw ? (JSON.parse(raw) as Stored<T>) : null;
  const wait = stored?.error ? BUDGET.readingRetryMs : BUDGET.readingFreshMs;
  if (!stored || now - stored.triedAt >= wait) {
    const loaded = await load().catch(errorName);
    stored =
      typeof loaded === "string"
        ? { value: stored?.value ?? null, readAt: stored?.readAt ?? null, error: loaded, triedAt: now }
        : { value: loaded, readAt: now, error: null, triedAt: now };
    await setSetting(q, KEY + name, JSON.stringify(stored));
  }
  const trusted = stored.readAt !== null && now - stored.readAt < BUDGET.readingStaleMs;
  return { value: trusted ? stored.value : null, readAt: stored.readAt, error: stored.error };
}
