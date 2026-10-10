import type { Color } from "../game/types";

/** Finished games sharing a model, time control and colour, as counted by the database. */
export type GameTally = {
  modelLabel: string;
  timeControl: string;
  playerColor: Color;
  played: number;
  won: number;
  drawn: number;
};

export type Tally = { played: number; won: number; lost: number; drawn: number };
export type Line = Tally & { name: string };
export type Stats = { overall: Tally; byModel: Line[]; byTimeControl: Line[]; byColor: Line[] };

const EMPTY: Tally = { played: 0, won: 0, lost: 0, drawn: 0 };

const add = (sum: Tally, row: GameTally): Tally => ({
  played: sum.played + row.played,
  won: sum.won + row.won,
  lost: sum.lost + (row.played - row.won - row.drawn),
  drawn: sum.drawn + row.drawn,
});

/** One line per distinct name, most played first. */
function split(rows: GameTally[], nameOf: (row: GameTally) => string): Line[] {
  const names = [...new Set(rows.map(nameOf))];
  return names
    .map((name) => ({ name, ...rows.filter((row) => nameOf(row) === name).reduce(add, EMPTY) }))
    .sort((a, b) => b.played - a.played || a.name.localeCompare(b.name));
}

/** A player's record, overall and broken down three ways. */
export function summarise(rows: GameTally[]): Stats {
  return {
    overall: rows.reduce(add, EMPTY),
    byModel: split(rows, (row) => row.modelLabel),
    byTimeControl: split(rows, (row) => row.timeControl),
    byColor: split(rows, (row) => row.playerColor),
  };
}

/** Games won as a whole percentage, or null before any game is finished. */
export const winRate = (tally: Tally): number | null =>
  tally.played === 0 ? null : Math.round((tally.won / tally.played) * 100);
