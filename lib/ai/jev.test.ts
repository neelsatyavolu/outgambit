import { describe, expect, it } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { jevAdapter, testJevKey } from "./jev";

type Criteria = Record<string, string>;
const criteriaOf = (body: Record<string, unknown>) =>
  (body.questions as { move: { criteria: Criteria; type: string } }).move.criteria;
const choose = (choice: string) => json({ model: "jev-1.13.0", answers: { move: { type: "choice", choice, confidence: 0.4, probabilities: {} } } });

describe("jevAdapter", () => {
  it("asks one Choice question listing every legal move once", async () => {
    const { fetcher, calls } = fakeFetch(() => choose("g1f3"));
    const request = requestFor();
    await jevAdapter("ts-key", { fetch: fetcher })(request);
    expect(calls[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0].headers.authorization).toBe("Bearer ts-key");
    expect(calls[0].body.model).toBe("jev-latest");
    expect(Object.keys(criteriaOf(calls[0].body)).sort()).toEqual(request.legalMoves.map((m) => m.uci).sort());
    expect(criteriaOf(calls[0].body).g1f3).toBe("Knight from g1 to f3");
  });

  it("gives Jev the board, the side to move and the game so far", async () => {
    const { fetcher, calls } = fakeFetch(() => choose("e7e5"));
    await jevAdapter("k", { fetch: fetcher })(requestFor(["e4"]));
    expect(calls[0].body.state).toMatchObject({ side_to_move: "black", moves_so_far: "1. e4" });
    expect((calls[0].body.state as { board: string }).board).toContain("8 r n b q k b n r");
  });

  it("puts the options in the order the shuffle gives", async () => {
    const { fetcher, calls } = fakeFetch(() => choose("g1f3"));
    const request = requestFor();
    // An rng that always returns 0 moves each remaining first item to the end.
    await jevAdapter("k", { fetch: fetcher, rng: () => 0 })(request);
    const sent = Object.keys(criteriaOf(calls[0].body));
    expect(sent).not.toEqual(request.legalMoves.map((m) => m.uci));
    expect(sent).toHaveLength(20);
  });

  it("does not reorder the caller's move list", async () => {
    const { fetcher } = fakeFetch(() => choose("g1f3"));
    const request = requestFor();
    const before = request.legalMoves.map((m) => m.uci);
    await jevAdapter("k", { fetch: fetcher, rng: () => 0 })(request);
    expect(request.legalMoves.map((m) => m.uci)).toEqual(before);
  });

  it("returns the chosen move in SAN", async () => {
    const { fetcher } = fakeFetch(() => choose("g1f3"));
    expect(await jevAdapter("k", { fetch: fetcher })(requestFor())).toEqual({ kind: "move", san: "Nf3" });
  });

  it("reports a choice that is not one of the options", async () => {
    const { fetcher } = fakeFetch(() => choose("z9z9"));
    expect(await jevAdapter("k", { fetch: fetcher })(requestFor())).toEqual({ kind: "invalid", raw: "z9z9" });
  });

  it("maps HTTP failures and malformed answers to provider errors", async () => {
    const bad = fakeFetch(() => json({ detail: "x" }, 429));
    expect(await jevAdapter("k", { fetch: bad.fetcher })(requestFor())).toEqual({ kind: "provider_error", message: "HTTP 429" });
    const empty = fakeFetch(() => json({ answers: {} }));
    expect((await jevAdapter("k", { fetch: empty.fetcher })(requestFor())).kind).toBe("provider_error");
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
