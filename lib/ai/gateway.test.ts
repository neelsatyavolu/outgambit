import { describe, expect, it } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { gatewayAdapter } from "./gateway";

type Question = { type: string; criteria: Record<string, string>; instructions: unknown };
const answer = (choice: string) => ({ type: "choice", choice, probabilities: { [choice]: 1 } });

describe("gatewayAdapter", () => {
  it("asks the game's model through AI Gateway's decision endpoint", async () => {
    const { fetcher, calls } = fakeFetch(() => json({ answers: { a: answer("g1f3"), b: answer("g1f3") } }));
    const result = await gatewayAdapter("vck-key", { fetch: fetcher })(requestFor([], { model: "liquid/d1" }));
    expect(result).toEqual({ kind: "move", san: "Nf3" });
    expect(calls[0].url).toBe("https://ai-gateway.vercel.sh/v1/evaluate");
    expect(calls[0].headers.authorization).toBe("Bearer vck-key");
    expect(calls[0].body.model).toBe("liquid/d1");
  });

  it("sends the position as plain text and the question as a plain string", async () => {
    const { fetcher, calls } = fakeFetch(() => json({ answers: { a: answer("e7e5"), b: answer("e7e5") } }));
    await gatewayAdapter("k", { fetch: fetcher })(requestFor(["e4"], { model: "liquid/d1" }));
    expect(typeof calls[0].body.state).toBe("string");
    expect(calls[0].body.state).toContain("Side to move: black");
    const { a, b } = calls[0].body.questions as Record<string, Question>;
    expect(typeof a.instructions).toBe("string");
    expect(Object.keys(b.criteria)).toEqual(Object.keys(a.criteria).reverse());
  });

  it("reports the input tokens AI Gateway billed, which it spells in camel case", async () => {
    const usage = { inputTokens: 44, outputTokens: 0 };
    const { fetcher } = fakeFetch(() => json({ answers: { a: answer("g1f3"), b: answer("g1f3") }, usage }));
    const result = await gatewayAdapter("k", { fetch: fetcher })(requestFor([], { model: "liquid/d1" }));
    expect(result).toEqual({ kind: "move", san: "Nf3", inputTokens: 44 });
  });

  it("maps a refused or rate-limited request to a provider error", async () => {
    for (const status of [403, 429]) {
      const { fetcher } = fakeFetch(() => json({ error: { message: "no" } }, status));
      const result = await gatewayAdapter("k", { fetch: fetcher })(requestFor([], { model: "liquid/d1" }));
      expect(result).toEqual({ kind: "provider_error", message: `HTTP ${status}` });
    }
  });
});
