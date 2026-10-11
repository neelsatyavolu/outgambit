import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { HUNT_LIMITS, forcedMates, type MateLimits } from "./mate";

/** Every move tried, with room to finish: what the search can find, apart from how long a game gives it. */
const THOROUGH: MateLimits = { moves: 3, positions: 5_000, wide: true };

const mates = (fen: string, limits?: Parameters<typeof forcedMates>[1]) => forcedMates(new Chess(fen), limits).sort();

describe("forcedMates", () => {
  it("is every mate in one when there is one", () => {
    const chess = new Chess();
    for (const san of ["f3", "e5", "g4"]) chess.move(san);
    expect(forcedMates(chess)).toEqual(["Qh4#"]);
  });

  it("finds a mate in two that begins with a check", () => {
    // Queen and knight against a cornered king: Qg8+ makes the rook take, and Nf7 mates.
    expect(mates("5r1k/6pp/7N/8/2Q5/8/8/6K1 w - - 0 1")).toEqual(["Qg8+"]);
  });

  it("finds a mate that begins quietly only when told to try quiet moves", () => {
    // King f6 and queen e1 against a king on h8: stepping to f7 leaves only Kh7, and Qh1 mates.
    // By checks alone there is only a slower mate, in three.
    expect(mates("7k/8/5K2/8/8/8/8/4Q3 w - - 0 1")).toEqual(["Qe8+", "Qh1+", "Qh4+"]);
    expect(mates("7k/8/5K2/8/8/8/8/4Q3 w - - 0 1", HUNT_LIMITS)).toEqual(["Kf7", "Kg6", "Qe7", "Qg1", "Qg3"]);
  });

  it("finds a mate in three that is all checks, in a crowded position", () => {
    // The smothered mate: Nh6+ Kh8, Qg8+ Rxg8, Nf7#.
    expect(mates("5rk1/5Npp/8/8/2Q5/8/8/6K1 w - - 0 1")).toEqual(["Nh6+"]);
  });

  it("finds a mate in three that begins quietly, when told to try quiet moves", () => {
    expect(mates("8/3Q4/1k6/3K4/8/8/8/8 w - - 0 1", THOROUGH)).toEqual(["Kc4"]);
    expect(mates("7Q/8/8/8/2K5/8/8/3k4 w - - 0 1", THOROUGH)).toEqual(["Kd3"]);
  });

  it("prefers the quicker mate to a slower one", () => {
    // The same position also has many mates in three; only the first moves of the mates in two are given.
    expect(mates("7k/8/5K2/8/8/8/8/4Q3 w - - 0 1", HUNT_LIMITS)).not.toContain("Qa1");
  });

  it("looks no further than it is told to", () => {
    expect(mates("8/3Q4/1k6/3K4/8/8/8/8 w - - 0 1", { ...THOROUGH, moves: 2 })).toEqual([]);
  });

  it("gives up, finding nothing, once it has looked at as many positions as it may", () => {
    expect(mates("8/3Q4/1k6/3K4/8/8/8/8 w - - 0 1", { ...THOROUGH, positions: 20 })).toEqual([]);
  });

  it("does not take a stalemate for a mate", () => {
    // Queen f7 against a king on h8 with the white king far off: every square is covered, and nothing mates in three.
    expect(mates("7k/5Q2/8/8/8/8/8/K7 w - - 0 1", THOROUGH)).toEqual([]);
  });

  it("finds nothing in the starting position", () => {
    expect(forcedMates(new Chess())).toEqual([]);
  });

  it("leaves the board as it found it", () => {
    const chess = new Chess("8/3Q4/1k6/3K4/8/8/8/8 w - - 0 1");
    const before = chess.fen();
    forcedMates(chess, THOROUGH);
    expect(chess.fen()).toBe(before);
    expect(chess.history()).toEqual([]);
  });
});
