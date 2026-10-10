import type { Seat } from "../game/types";
import type { Pool } from "../rating/elo";

/** One rated line that takes part: a model, at the arena's effort, in one pool. */
export type Entry = { key: string; pool: Pool; rating: number; games: number; seat: Seat };

export type Pairing = { pool: Pool; white: Entry; black: Entry };

/** How often two lines have met in a pool, whichever colours they had. */
export type Meetings = ReadonlyMap<string, number>;

export const meetingKey = (a: string, b: string, pool: Pool): string => `${pool}|${[a, b].sort().join("|")}`;

/** The items with the lowest score, in their original order. */
function lowest<T>(items: readonly T[], score: (item: T) => number): T[] {
  const best = Math.min(...items.map(score));
  return items.filter((item) => score(item) === best);
}

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)];

/**
 * The next game worth playing. The line with the fewest rated games goes
 * first, since its rating is the least certain. It meets the opponent it has
 * played least, and among those the one rated closest, because a close game
 * says the most about both. Null when no pool has two lines.
 */
export function nextPairing(entries: readonly Entry[], meetings: Meetings, random: () => number): Pairing | null {
  const paired = entries.filter((e) => entries.some((other) => other.pool === e.pool && other.key !== e.key));
  if (paired.length === 0) return null;
  const first = pick(lowest(paired, (e) => e.games), random);
  const others = paired.filter((e) => e.pool === first.pool && e.key !== first.key);
  const leastMet = lowest(others, (e) => meetings.get(meetingKey(first.key, e.key, first.pool)) ?? 0);
  const second = pick(lowest(leastMet, (e) => Math.abs(e.rating - first.rating)), random);
  const [white, black] = random() < 0.5 ? [first, second] : [second, first];
  return { pool: first.pool, white, black };
}
