import { describe, expect, it } from "vitest";
import { jevAdapter } from "@/lib/ai/jev";
import { replay } from "@/lib/chess/rules";

// A direct check of the Jev request shape, for when no key is stored in the
// app yet. Set TYPESAFE_API_KEY in the environment to run it.
const apiKey = process.env.TYPESAFE_API_KEY;

const POSITIONS: Array<[name: string, history: string[]]> = [
  ["the opening position", []],
  ["an open middlegame", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+", "Nc3", "Nxe4", "O-O"]],
];

describe.skipIf(!apiKey)("Jev", () => {
  it.each(POSITIONS)("picks a legal move in %s", async (_name, history) => {
    const position = replay(history);
    const started = Date.now();
    const result = await jevAdapter(apiKey!)({
      fen: position.fen,
      history,
      legalMoves: position.legal,
      color: position.turn,
      remainingMs: 60_000,
      model: "jev-latest",
      signal: AbortSignal.timeout(10_000),
    });
    // Reported so the run shows how many options were sent and how long Jev took.
    expect({ result, options: position.legal.length, ms: Date.now() - started }).toMatchObject({
      result: { kind: "move" },
    });
    expect(position.legal.map((m) => m.san)).toContain(result.kind === "move" ? result.san : "");
  });
});
