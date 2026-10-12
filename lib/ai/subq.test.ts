import { describe, expect, it } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { subqAdapter, testSubqKey } from "./subq";

type Question = { type: string; criteria: Record<string, string>; instructions: unknown };
const answer = (choice: string) => ({ type: "choice", choice, probabilities: { [choice]: 1 } });

describe("subqAdapter", () => {
  it("asks subq-snap-preview through Subquadratic's decisions endpoint", async () => {
    const { fetcher, calls } = fakeFetch(() => json({ answers: { a: answer("g1f3"), b: answer("g1f3") } }));
    const result = await subqAdapter("sq-key", { fetch: fetcher })(requestFor());
    expect(result).toEqual({ kind: "move", san: "Nf3" });
    expect(calls[0].url).toBe("https://api.subq.ai/v1/systemone");
    expect(calls[0].headers.authorization).toBe("Bearer sq-key");
    expect(calls[0].body.model).toBe("subq-snap-preview");
  });

  it("sends the position as structured state and the options in two orders", async () => {
    const { fetcher, calls } = fakeFetch(() => json({ answers: { a: answer("e7e5"), b: answer("e7e5") } }));
    await subqAdapter("k", { fetch: fetcher })(requestFor(["e4"]));
    expect(calls[0].body.state).toMatchObject({ side_to_move: "black" });
    const { a, b } = calls[0].body.questions as Record<string, Question>;
    expect(typeof a.instructions).toBe("object");
    expect(Object.keys(b.criteria)).toEqual(Object.keys(a.criteria).reverse());
  });

  it("reports the input tokens Subquadratic billed", async () => {
    const usage = { input_tokens: 44, output_tokens: 0 };
    const { fetcher } = fakeFetch(() => json({ answers: { a: answer("g1f3"), b: answer("g1f3") }, usage }));
    const result = await subqAdapter("k", { fetch: fetcher })(requestFor());
    expect(result).toEqual({ kind: "move", san: "Nf3", inputTokens: 44 });
  });

  it("maps a refused or rate-limited request to a provider error", async () => {
    for (const status of [403, 429]) {
      const { fetcher } = fakeFetch(() => json({ error: { message: "no" } }, status));
      const result = await subqAdapter("k", { fetch: fetcher })(requestFor());
      expect(result).toEqual({ kind: "provider_error", message: `HTTP ${status}` });
    }
  });
});

describe("testSubqKey", () => {
  it("sends the cheapest call and accepts a key the API accepts", async () => {
    const { fetcher, calls } = fakeFetch(() => json({ answers: { ok: { type: "noul" } } }));
    expect(await testSubqKey("sq-key", fetcher)).toBe(true);
    expect(calls[0].url).toBe("https://api.subq.ai/v1/systemone");
    expect(calls[0].headers.authorization).toBe("Bearer sq-key");
    expect(calls[0].body.model).toBe("subq-snap-preview");
    expect((calls[0].body.questions as { ok: { type: string } }).ok.type).toBe("noul");
  });

  it("rejects a key the API refuses, or a call that never answers", async () => {
    const { fetcher } = fakeFetch(() => json({}, 401));
    expect(await testSubqKey("k", fetcher)).toBe(false);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await testSubqKey("k", down)).toBe(false);
  });
});
