import { describe, expect, it } from "vitest";
import type { Pool } from "../rating/elo";
import { meetingKey, nextPairing, type Entry } from "./pairing";

const entry = (key: string, overrides: Partial<Entry> = {}): Entry => ({
  key,
  pool: "regular",
  rating: 1000,
  games: 0,
  seat: { provider: "gemini", model: key, modelLabel: key.toUpperCase(), effort: null },
  ...overrides,
});

const first = () => 0;
const none = new Map<string, number>();
const met = (pairs: Array<[string, string, number, Pool?]>) =>
  new Map(pairs.map(([a, b, count, pool]) => [meetingKey(a, b, pool ?? "regular"), count]));

const keys = (entries: readonly Entry[], meetings = none, random = first) => {
  const pairing = nextPairing(entries, meetings, random);
  return pairing && [pairing.white.key, pairing.black.key].sort();
};

describe("nextPairing", () => {
  it("has nothing to pair with fewer than two entries in a pool", () => {
    expect(nextPairing([], none, first)).toBeNull();
    expect(nextPairing([entry("a")], none, first)).toBeNull();
    expect(nextPairing([entry("a"), entry("b", { pool: "bullet" })], none, first)).toBeNull();
  });

  it("starts with the entry that has played least", () => {
    const entries = [entry("a", { games: 5 }), entry("b", { games: 1 }), entry("c", { games: 3, rating: 1010 })];
    expect(keys(entries)).toContain("b");
  });

  it("gives it the opponent it has met least", () => {
    const entries = [entry("a"), entry("b", { games: 2 }), entry("c", { games: 2 })];
    expect(keys(entries, met([["a", "b", 1]]))).toEqual(["a", "c"]);
    expect(keys(entries, met([["c", "a", 1]]))).toEqual(["a", "b"]);
  });

  it("prefers the closest rating among opponents met equally often", () => {
    const entries = [entry("a", { rating: 1000 }), entry("b", { games: 2, rating: 1400 }), entry("c", { games: 2, rating: 950 })];
    expect(keys(entries)).toEqual(["a", "c"]);
  });

  it("only pairs within a pool, and counts meetings per pool", () => {
    const entries = [
      entry("a", { pool: "bullet" }),
      entry("b", { pool: "bullet", games: 1 }),
      entry("c", { games: 1 }),
      entry("d", { games: 1 }),
    ];
    const pairing = nextPairing(entries, met([["a", "b", 9, "regular"]]), first);
    expect(pairing).toMatchObject({ pool: "bullet", white: { pool: "bullet" }, black: { pool: "bullet" } });
  });

  it("skips an entry that is alone in its pool, however little it has played", () => {
    const entries = [entry("a", { pool: "bullet" }), entry("b", { games: 4 }), entry("c", { games: 7 })];
    expect(keys(entries)).toEqual(["b", "c"]);
  });

  it("breaks ties and picks colours at random", () => {
    const entries = [entry("a"), entry("b"), entry("c")];
    const last = () => 0.999;
    expect(keys(entries, none, last)).not.toEqual(keys(entries, none, first));
    const white = (random: () => number) => nextPairing([entry("a"), entry("b", { games: 1 })], none, random)!.white.key;
    expect(white(first)).not.toBe(white(last));
  });

  it("treats a meeting the same whichever side is named first", () => {
    expect(meetingKey("a", "b", "bullet")).toBe(meetingKey("b", "a", "bullet"));
    expect(meetingKey("a", "b", "bullet")).not.toBe(meetingKey("a", "b", "regular"));
  });
});
