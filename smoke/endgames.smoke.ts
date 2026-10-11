import { describe, expect, it } from "vitest";
import { WON_ENDGAMES, playOut, type Defender } from "@/test/endgames";

// Plays every won endgame in test/endgames.ts out, several times against each defender, with a random pick from
// the shortlist standing in for the model. Needs no keys and spends nothing. Run with ENDGAME_BENCH=1; it takes a
// minute or two, which is why only a few of these games are in `pnpm test`.
const GAMES = Number(process.env.ENDGAME_BENCH_GAMES ?? 8);
const DEFENDERS: readonly Defender[] = ["random", "stubborn"];

describe.skipIf(!process.env.ENDGAME_BENCH)("won endgames, played out with a random pick from the shortlist", () => {
  it("are won", () => {
    const report: Record<string, string> = {};
    let games = 0;
    let mated = 0;
    let turns = 0;
    const started = Date.now();
    for (const [name, fen] of Object.entries(WON_ENDGAMES)) {
      for (const defender of DEFENDERS) {
        const played = Array.from({ length: GAMES }, (_, seed) => playOut(fen, defender, seed + 1));
        const wins = played.filter((game) => game.outcome === "mate");
        const average = wins.reduce((sum, game) => sum + game.moves, 0) / Math.max(1, wins.length);
        report[`${name}, ${defender}`] = `${wins.length}/${GAMES} mated, in ${Math.round(average)} moves`;
        games += GAMES;
        mated += wins.length;
        turns += played.reduce((sum, game) => sum + game.moves, 0);
      }
    }
    const msPerTurn = Math.round((Date.now() - started) / turns);
    process.stdout.write(`\nENDGAME_BENCH ${JSON.stringify({ mated, games, msPerTurn, ...report }, null, 1)}\n`);
    // A lone rook against a king that stays in the middle is the hard one; the rest are expected every time.
    expect(mated / games).toBeGreaterThan(0.9);
  });
});
