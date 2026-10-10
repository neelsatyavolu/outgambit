import type { Adapter } from "./types";

/**
 * A scripted opponent for tests. Entry N of the script is the AI's Nth move;
 * when the script has no legal entry it plays the first legal move.
 */
export function fakeAdapter(script: readonly string[]): Adapter {
  return async (request) => {
    const wanted = script[Math.floor(request.history.length / 2)];
    const move = request.legalMoves.find((m) => m.san === wanted) ?? request.legalMoves[0];
    return { kind: "move", san: move.san };
  };
}
