/** Who is sharing a day's games: who has played, who usually does, and how much of the day is left. */
export type Crowd = { activeToday: number; dailyAverage: number; dayFractionLeft: number };

/**
 * How many players a day's games are split between: those who have played
 * today, and those still expected. The expected ones shrink as the day runs
 * out, which hands their unused shares to whoever did turn up.
 */
export function expectedPlayers(crowd: Crowd): number {
  return Math.max(1, crowd.activeToday + Math.ceil(crowd.dailyAverage * crowd.dayFractionLeft));
}

/** One player's games for the day. Never less than one, so a small budget goes to whoever comes first. */
export function playerShare(dayBudget: number, expected: number): number {
  return Math.max(1, Math.floor(dayBudget / expected));
}
