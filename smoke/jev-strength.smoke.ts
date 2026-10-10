import { describe, expect, it } from "vitest";
import { jevAdapter } from "@/lib/ai/jev";
import type { Adapter } from "@/lib/ai/types";
import { applyMove, replay } from "@/lib/chess/rules";

// Measures how Jev plays, with and without the one-move tactics done in code,
// against an opponent that moves at random. Run with JEV_BENCH=1 and
// TYPESAFE_API_KEY set. Each game is a few dozen Jev calls.
const apiKey = process.env.TYPESAFE_API_KEY;
const GAMES = Number(process.env.JEV_BENCH_GAMES ?? 4);
const MAX_PLIES = 70;
const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** A small repeatable random source, so both versions meet the same opponent. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function material(fen: string): number {
  return [...fen.split(" ")[0]].reduce((sum, ch) => {
    const value = VALUES[ch.toLowerCase()];
    return value ? sum + (ch === ch.toUpperCase() ? value : -value) : sum;
  }, 0);
}

type Tally = { wins: number; losses: number; draws: number; unfinished: number; material: number; calls: number; ms: number };

async function playGame(jev: Adapter, jevIsWhite: boolean, random: () => number, tally: Tally): Promise<void> {
  const history: string[] = [];
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const position = replay(history);
    if (position.outcome) {
      const jevColor = jevIsWhite ? "white" : "black";
      if (position.outcome.result === "draw") tally.draws++;
      else if (position.outcome.result === jevColor) tally.wins++;
      else tally.losses++;
      return;
    }
    const jevToMove = (position.turn === "white") === jevIsWhite;
    let san: string;
    if (jevToMove) {
      const started = Date.now();
      const result = await jev({
        fen: position.fen, history: [...history], legalMoves: position.legal, color: position.turn,
        remainingMs: 60_000, model: "jev-latest", signal: AbortSignal.timeout(10_000),
      });
      tally.calls++;
      tally.ms += Date.now() - started;
      if (result.kind !== "move") throw new Error(`Jev failed: ${JSON.stringify(result)}`);
      san = result.san;
    } else {
      san = position.legal[Math.floor(random() * position.legal.length)].san;
    }
    history.push(applyMove(history, san)!.san);
  }
  tally.unfinished++;
  tally.material += material(replay(history).fen) * (jevIsWhite ? 1 : -1);
}

async function series(assist: boolean): Promise<Tally> {
  const tally: Tally = { wins: 0, losses: 0, draws: 0, unfinished: 0, material: 0, calls: 0, ms: 0 };
  const jev = jevAdapter(apiKey!, { assist });
  for (let game = 0; game < GAMES; game++) await playGame(jev, game % 2 === 0, seeded(game + 1), tally);
  return tally;
}

/** Assisted Jev against plain Jev. Returns the result from the assisted side's point of view. */
async function headToHead(assistedIsWhite: boolean): Promise<{ result: "win" | "loss" | "draw" | "unfinished"; material: number; plies: number }> {
  const sides = { assisted: jevAdapter(apiKey!, { assist: true }), plain: jevAdapter(apiKey!, { assist: false }) };
  const history: string[] = [];
  for (let ply = 0; ply < 100; ply++) {
    const position = replay(history);
    if (position.outcome) {
      const mine = assistedIsWhite ? "white" : "black";
      const result = position.outcome.result === "draw" ? "draw" : position.outcome.result === mine ? "win" : "loss";
      return { result, material: 0, plies: ply };
    }
    const assistedToMove = (position.turn === "white") === assistedIsWhite;
    const result = await (assistedToMove ? sides.assisted : sides.plain)({
      fen: position.fen, history: [...history], legalMoves: position.legal, color: position.turn,
      remainingMs: 60_000, model: "jev-latest", signal: AbortSignal.timeout(10_000),
    });
    if (result.kind !== "move") throw new Error(`Jev failed: ${JSON.stringify(result)}`);
    history.push(applyMove(history, result.san)!.san);
  }
  return { result: "unfinished", material: material(replay(history).fen) * (assistedIsWhite ? 1 : -1), plies: 100 };
}

describe.skipIf(!apiKey || !process.env.JEV_BENCH)("Jev against a random mover", () => {
  it("beats unassisted Jev head to head", async () => {
    const games = [];
    for (let game = 0; game < GAMES; game++) games.push(await headToHead(game % 2 === 0));
    process.stdout.write(`\nJEV_H2H ${JSON.stringify(games)}\n`);
    const points = games.reduce((sum, g) => sum + (g.result === "win" ? 100 : g.result === "loss" ? -100 : g.material), 0);
    expect(points).toBeGreaterThan(0);
  });

  it("plays better with one-move tactics done in code", async () => {
    const plain = await series(false);
    const assisted = await series(true);
    const report = (t: Tally) => ({
      wins: t.wins, losses: t.losses, draws: t.draws, unfinished: t.unfinished,
      materialLeadInUnfinished: t.material, turns: t.calls, msPerTurn: Math.round(t.ms / Math.max(1, t.calls)),
    });
    process.stdout.write(`\nJEV_BENCH ${JSON.stringify({ games: GAMES, plain: report(plain), assisted: report(assisted) })}\n`);
    expect(assisted.wins * 100 + assisted.material).toBeGreaterThan(plain.wins * 100 + plain.material);
  });
});
