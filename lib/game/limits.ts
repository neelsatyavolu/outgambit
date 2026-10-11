import { DAY_TIME_ZONE } from "../config";

// en-CA formats dates as YYYY-MM-DD.
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Pacific calendar date a moment falls on. */
export const dayKey = (now: number): string => dayFormat.format(new Date(now));

const LONGEST_DAY_MS = 26 * 60 * 60 * 1000;

/** The next Pacific midnight. Found by search, so 23- and 25-hour days need no special case. */
export function nextResetAt(now: number): number {
  const today = dayKey(now);
  let stillToday = now;
  let tomorrow = now + LONGEST_DAY_MS;
  while (tomorrow - stillToday > 1) {
    const middle = Math.floor((stillToday + tomorrow) / 2);
    if (dayKey(middle) === today) stillToday = middle;
    else tomorrow = middle;
  }
  return tomorrow;
}
