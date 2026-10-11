import { describe, expect, it } from "vitest";
import { WON_ENDGAMES, playOut } from "@/test/endgames";

// A few of the games the benchmark in smoke/endgames.smoke.ts plays in full: enough to notice if a change to the
// shortlist stops it finishing a won game, without slowing every test run down.
describe("a won endgame, with only a random pick from the shortlist to play it", () => {
  it.each([
    ["queen", "stubborn"],
    ["rook", "stubborn"],
    ["queen and pawns against pawns", "random"],
  ] as const)("is won with a %s against a %s defender", (name, defender) => {
    expect(playOut(WON_ENDGAMES[name], defender, 1)).toMatchObject({ outcome: "mate" });
  });
});
