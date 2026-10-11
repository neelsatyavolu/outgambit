import { describe, expect, it } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { NOTE } from "../chess/notes";
import { INSTRUCTIONS, instructionsFor } from "./decision";
import { jevAdapter, testJevKey } from "./jev";

type Question = { type: string; criteria: Record<string, string>; instructions: unknown };
const questionsOf = (body: Record<string, unknown>) => body.questions as Record<string, Question>;
const answer = (choice: string, probabilities: Record<string, number> = {}) => ({ type: "choice", choice, confidence: 0.4, probabilities });
const respond = (a: ReturnType<typeof answer>, b: ReturnType<typeof answer> = a) => json({ model: "jev-1.13.0", answers: { a, b } });

const FREE_QUEEN = ["e4", "e5", "Nf3", "Qh4"]; // white can simply take the queen
const QUEEN_ATTACKED = ["e4", "d5", "exd5", "Qxd5", "Nc3"]; // black must move the queen
const MATE_IN_ONE = ["f3", "e5", "g4"]; // black mates with Qh4#

describe("jevAdapter", () => {
  it("asks the same Choice twice, with the options in two different orders", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("g1f3")));
    const request = requestFor();
    await jevAdapter("ts-key", { fetch: fetcher })(request);
    expect(calls[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0].headers.authorization).toBe("Bearer ts-key");
    expect(calls[0].body.model).toBe("jev-latest");
    const { a, b } = questionsOf(calls[0].body);
    expect(a.type).toBe("choice");
    expect(Object.keys(a.criteria).sort()).toEqual(request.legalMoves.map((m) => m.uci).sort());
    expect(Object.keys(b.criteria).sort()).toEqual(Object.keys(a.criteria).sort());
    expect(Object.keys(b.criteria)).not.toEqual(Object.keys(a.criteria));
  });

  it("gives Jev the board, the side to move and the game so far", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("e7e5")));
    await jevAdapter("k", { fetch: fetcher })(requestFor(["e4"]));
    expect(calls[0].body.state).toMatchObject({ side_to_move: "black", last_moves: "1. e4" });
    expect((calls[0].body.state as { board: string }).board).toContain("8 r n b q k b n r");
  });

  it("describes each option in words, with what it does for the position", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("g1f3")));
    await jevAdapter("k", { fetch: fetcher })(requestFor());
    const { criteria } = questionsOf(calls[0].body).a;
    expect(criteria.g1f3).toBe("Knight from g1 to f3, develops a piece");
    expect(criteria.e2e4).toBe("Pawn from e2 to e4, claims the centre");
    expect(criteria.a2a3).toBe("Pawn from a2 to a3");
  });

  it("tells Jev the phase of the game and who is ahead", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("e7e5")));
    await jevAdapter("k", { fetch: fetcher })(requestFor(["e4"]));
    expect(calls[0].body.state).toMatchObject({ phase: "opening", material: "level" });
    // White has taken a queen for nothing.
    await jevAdapter("k", { fetch: fetcher })(requestFor([...FREE_QUEEN, "Nxh4"]));
    expect(calls[1].body.state).toMatchObject({ side_to_move: "black", material: "white is ahead by 9 (pawn 1, knight or bishop 3, rook 5, queen 9)" });
  });

  it("gives advice that fits the phase", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("g1f3")));
    await jevAdapter("k", { fetch: fetcher })(requestFor());
    expect(questionsOf(calls[0].body).a.instructions).toEqual(instructionsFor("opening"));
    expect(instructionsFor("opening").guidance).toContain("develop knights and bishops");
    expect(instructionsFor("middlegame").guidance).toContain("rook to an open file");
    expect(instructionsFor("endgame").guidance).toContain("advance passed pawns");
    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      expect(instructionsFor(phase).guidance).toContain("threatens checkmate");
    }
  });

  it("only gives advice about something when an option does it, to keep the question short", () => {
    const plain = instructionsFor("middlegame").guidance;
    expect(plain).not.toMatch(/repeats|trade|draws|winning/);
    expect(instructionsFor("middlegame", 0, [NOTE.repeats]).guidance).toContain("repeats an earlier position");
    expect(instructionsFor("middlegame", 0, [NOTE.draws]).guidance).toContain("draws the game at once");
    // A trade is good or bad by who is ahead, and neither when the material is level.
    expect(instructionsFor("middlegame", 2, [NOTE.trade]).guidance).toContain("an even trade helps");
    expect(instructionsFor("middlegame", -2, [NOTE.trade]).guidance).toContain("avoid an even trade");
    expect(instructionsFor("middlegame", 0, [NOTE.trade]).guidance).toBe(plain);
  });

  it("tells a side that is clearly ahead how to finish the game", () => {
    expect(instructionsFor("endgame", 5).guidance).toContain("leave the enemy king fewer squares");
    expect(instructionsFor("endgame", 2).guidance).not.toContain("fewer squares");
  });

  it("sends only the last few moves of a long game", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("e7e5")));
    const shuffle = ["Nf3", "Nf6", "Ng1", "Ng8"];
    await jevAdapter("k", { fetch: fetcher })(requestFor([...shuffle, ...shuffle, ...shuffle, "e4"]));
    expect((calls[0].body.state as { last_moves: string }).last_moves).toBe("... 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. Nf3 Nf6 6. Ng1 Ng8 7. e4");
  });

  it("says what a move threatens, ahead of what it does for the position", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("d1h5")));
    await jevAdapter("k", { fetch: fetcher })(requestFor(["e4", "e5", "Bc4", "Nc6"]));
    const { criteria } = questionsOf(calls[0].body).a;
    expect(criteria.d1h5).toBe("Queen from d1 to h5, threatens checkmate next move, brings the queen out early");
  });

  it("can leave the notes out, for measuring what they add", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("g1f3")));
    await jevAdapter("k", { fetch: fetcher, notes: false })(requestFor());
    const { a } = questionsOf(calls[0].body);
    expect(a.criteria.g1f3).toBe("Knight from g1 to f3");
    expect(a.instructions).toEqual(INSTRUCTIONS);
  });

  it("warns about an early queen move and a king walk", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("d1h5")));
    await jevAdapter("k", { fetch: fetcher })(requestFor(["e4", "e5"]));
    const { criteria } = questionsOf(calls[0].body).a;
    expect(criteria.d1h5).toBe("Queen from d1 to h5, brings the queen out early");
    expect(criteria.e1e2).toBe("King from e1 to e2, moves the king off its home square");
  });

  it("plays the move with the most support across both orderings", async () => {
    const { fetcher } = fakeFetch(() =>
      respond(answer("a2a3", { a2a3: 0.4, g1f3: 0.35, e2e4: 0.25 }), answer("g1f3", { g1f3: 0.5, a2a3: 0.2, e2e4: 0.3 })),
    );
    expect(await jevAdapter("k", { fetch: fetcher })(requestFor())).toEqual({ kind: "move", san: "Nf3" });
  });

  it("reports the input tokens the call was billed for, when Jev gives a sensible count", async () => {
    const billed = (usage: unknown) =>
      jevAdapter("k", { fetch: fakeFetch(() => json({ answers: { a: answer("e2e4"), b: answer("e2e4") }, usage })).fetcher })(requestFor());
    expect(await billed({ input_tokens: 391.4, output_tokens: 67 })).toEqual({ kind: "move", san: "e4", inputTokens: 391 });
    for (const usage of [undefined, {}, { input_tokens: "391" }, { input_tokens: -5 }, { input_tokens: 3e9 }, { input_tokens: Number.NaN }]) {
      expect((await billed(usage)).inputTokens).toBeUndefined();
    }
  });

  it("falls back to the stated choice when no probabilities come back", async () => {
    const { fetcher } = fakeFetch(() => respond(answer("e2e4")));
    expect(await jevAdapter("k", { fetch: fetcher })(requestFor())).toEqual({ kind: "move", san: "e4" });
  });

  it("offers only moves that are sound on material", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("d5a5")));
    await jevAdapter("k", { fetch: fetcher })(requestFor(QUEEN_ATTACKED));
    const offered = Object.keys(questionsOf(calls[0].body).a.criteria);
    expect(offered.length).toBeGreaterThan(1);
    expect(offered.every((uci) => uci.startsWith("d5"))).toBe(true);
  });

  it("plays checkmate in one without asking", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("a7a6")));
    expect(await jevAdapter("k", { fetch: fetcher })(requestFor(MATE_IN_ONE))).toEqual({ kind: "move", san: "Qh4#" });
    expect(calls).toHaveLength(0);
  });

  it("plays the only sound move without asking", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("a2a3")));
    expect(await jevAdapter("k", { fetch: fetcher })(requestFor(FREE_QUEEN))).toEqual({ kind: "move", san: "Nxh4" });
    expect(calls).toHaveLength(0);
  });

  it("does not reorder the caller's move list", async () => {
    const { fetcher } = fakeFetch(() => respond(answer("g1f3")));
    const request = requestFor();
    const before = request.legalMoves.map((m) => m.uci);
    await jevAdapter("k", { fetch: fetcher, rng: () => 0 })(request);
    expect(request.legalMoves.map((m) => m.uci)).toEqual(before);
  });

  it("reports a choice that is not one of the options", async () => {
    const { fetcher } = fakeFetch(() => respond(answer("z9z9")));
    expect(await jevAdapter("k", { fetch: fetcher })(requestFor())).toEqual({ kind: "invalid", raw: "z9z9" });
  });

  it("maps HTTP failures and malformed answers to provider errors", async () => {
    const bad = fakeFetch(() => json({ detail: "x" }, 429));
    expect(await jevAdapter("k", { fetch: bad.fetcher })(requestFor())).toEqual({ kind: "provider_error", message: "HTTP 429" });
    const empty = fakeFetch(() => json({ answers: {} }));
    expect((await jevAdapter("k", { fetch: empty.fetcher })(requestFor())).kind).toBe("provider_error");
  });

  it("can be run unassisted, with every legal move on offer, for comparison", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("a7a6")));
    const result = await jevAdapter("k", { fetch: fetcher, assist: false })(requestFor(MATE_IN_ONE));
    expect(result).toEqual({ kind: "move", san: "a6" });
    expect(Object.keys(questionsOf(calls[0].body).a.criteria)).toHaveLength(requestFor(MATE_IN_ONE).legalMoves.length);
  });
});

describe("testJevKey", () => {
  it("accepts a key the API accepts", async () => {
    const { fetcher } = fakeFetch(() => json({ answers: { ok: { type: "noul" } } }));
    expect(await testJevKey("k", fetcher)).toBe(true);
  });

  it("rejects a key the API refuses", async () => {
    const { fetcher } = fakeFetch(() => json({}, 401));
    expect(await testJevKey("k", fetcher)).toBe(false);
  });
});
