import { describe, expect, it } from "vitest";
import { isForcingNote, focusMoves, noteScore, survey } from "@/lib/chess/notes";
import { applyMove, replay } from "@/lib/chess/rules";
import { assessMoves, shortlist } from "@/lib/chess/tactics";
import { matchElo, type MatchElo } from "@/lib/rating/elo";

// Plays the move the code prefers, with no model and no clock, and reports the Elo gap.
// Run with ELO_BENCH=1. A game is a few seconds; the default match is a couple of minutes.
const GAMES = Number(process.env.ELO_BENCH_GAMES ?? 12);
const MAX_PLIES = 120;
/** A forcing note this far ahead is the move, as in the decision adapter. */
const OBVIOUS_MARGIN = 8;

type Player = (history: readonly string[], rng: () => number) => string;
type GameResult = "win" | "loss" | "draw";

/** A small repeatable random source, so a match can be played again exactly. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const pickIndex = (length: number, rng: () => number): number => Math.min(length - 1, Math.floor(rng() * length));

/** The move the notes rank first. A forcing note that leads by the margin is taken on its own. */
function noted(history: readonly string[], rng: () => number): string {
  const tactical = shortlist(assessMoves(history)).map((row) => row.move);
  const view = survey(history, tactical.map((move) => move.uci));
  const moves = focusMoves(view, tactical, rng);
  const ranked = moves
    .map((move) => {
      const notes = view.notes.get(move.uci) ?? [];
      return { move, score: noteScore(notes, view.lead), forcing: notes.some(isForcingNote) };
    })
    .sort((a, b) => b.score - a.score || (a.move.uci < b.move.uci ? -1 : 1));
  const [top, second] = ranked;
  if (top?.forcing && (!second || top.score - second.score >= OBVIOUS_MARGIN)) return top.move.san;
  const best = top?.score ?? 0;
  const tied = ranked.filter((row) => row.score === best);
  return tied[pickIndex(tied.length, rng)]!.move.san;
}

/** Any move the tactics leave, which is the list before the notes rank it. */
function material(history: readonly string[], rng: () => number): string {
  const moves = shortlist(assessMoves(history));
  return moves[pickIndex(moves.length, rng)]!.move.san;
}

/** Any legal move. */
function random(history: readonly string[], rng: () => number): string {
  const moves = replay(history).legal;
  return moves[pickIndex(moves.length, rng)]!.san;
}

/** One game. `mine` is white when `mineIsWhite`. An unfinished game counts as a draw. */
function play(mine: Player, theirs: Player, mineIsWhite: boolean, seed: number): { result: GameResult; plies: number } {
  const mineRng = seeded(seed);
  const theirRng = seeded(seed + 100_003);
  const history: string[] = [];
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const position = replay(history);
    if (position.outcome) {
      if (position.outcome.result === "draw") return { result: "draw", plies: ply };
      const won = (position.outcome.result === "white") === mineIsWhite;
      return { result: won ? "win" : "loss", plies: ply };
    }
    const mineToMove = (position.turn === "white") === mineIsWhite;
    const san = (mineToMove ? mine : theirs)(history, mineToMove ? mineRng : theirRng);
    history.push(applyMove(history, san)!.san);
  }
  return { result: "draw", plies: MAX_PLIES };
}

function summarize(games: readonly GameResult[]): { wins: number; draws: number; losses: number; points: number; elo: MatchElo } {
  const wins = games.filter((result) => result === "win").length;
  const draws = games.filter((result) => result === "draw").length;
  const losses = games.length - wins - draws;
  const points = wins + draws / 2;
  return { wins, draws, losses, points, elo: matchElo(points, games.length) };
}

function formatElo(elo: MatchElo): string {
  const signed = `${elo.diff > 0 ? "+" : ""}${elo.diff}`;
  if (elo.bound) return elo.diff >= 0 ? `${signed} or more` : `${signed} or less`;
  return `${signed} ± ${elo.margin}`;
}

describe.skipIf(!process.env.ELO_BENCH)("local mover, scored as Elo", () => {
  it("reports the gap over a random sound move, and over a random legal move", () => {
    const started = Date.now();
    let plies = 0;
    const match = (mine: Player, theirs: Player): GameResult[] =>
      Array.from({ length: GAMES }, (_, game) => {
        const played = play(mine, theirs, game % 2 === 0, game + 1);
        plies += played.plies;
        return played.result;
      });
    const notes = summarize(match(noted, material));
    const tactics = summarize(match(material, random));
    const msPerPly = Math.round((Date.now() - started) / Math.max(1, plies));
    const report = {
      games: GAMES,
      msPerPly,
      notesOverMaterial: { record: `${notes.wins}-${notes.draws}-${notes.losses}`, points: notes.points, elo: formatElo(notes.elo) },
      materialOverRandom: { record: `${tactics.wins}-${tactics.draws}-${tactics.losses}`, points: tactics.points, elo: formatElo(tactics.elo) },
    };
    process.stdout.write(`\nELO_BENCH ${JSON.stringify(report, null, 1)}\n`);
    expect(tactics.points / GAMES).toBeGreaterThan(0.75);
  });
});
