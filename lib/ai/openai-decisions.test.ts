import { describe, expect, it } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { openAiDecisionsAdapter, testOpenAiKey } from "./openai-decisions";

type Choice = { value: string; description: string };
type Question = { type: string; name: string; instructions: string; choices: Choice[] };
const questionsOf = (body: Record<string, unknown>) => body.questions as Question[];
const answer = (name: string, choice: string, probabilities: Record<string, number> = {}) => ({
  type: "choice", name, choice, confidence: 0.5,
  probabilities: Object.entries(probabilities).map(([value, probability]) => ({ value, probability })),
});
const respond = (...answers: unknown[]) => json({ model: "gpt-6-luna", answers });

describe("openAiDecisionsAdapter", () => {
  it("posts two orderings of the same choice to the Decisions endpoint", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("a", "g1f3"), answer("b", "g1f3")));
    const request = requestFor();
    await openAiDecisionsAdapter("sk-key", { fetch: fetcher })(request);
    expect(calls[0].url).toBe("https://api.openai.com/v1/decisions");
    expect(calls[0].headers.authorization).toBe("Bearer sk-key");
    expect(calls[0].body.model).toBe("gpt-6-luna");
    const [a, b] = questionsOf(calls[0].body);
    expect([a.type, a.name, b.name]).toEqual(["choice", "a", "b"]);
    expect(a.choices.map((c) => c.value).sort()).toEqual(request.legalMoves.map((m) => m.uci).sort());
    expect(b.choices.map((c) => c.value)).toEqual([...a.choices.map((c) => c.value)].reverse());
    expect(a.choices.find((c) => c.value === "g1f3")?.description).toBe("Knight from g1 to f3, develops a piece");
    expect(typeof a.instructions).toBe("string");
  });

  it("sends the position as plain text", async () => {
    const { fetcher, calls } = fakeFetch(() => respond(answer("a", "e7e5"), answer("b", "e7e5")));
    await openAiDecisionsAdapter("k", { fetch: fetcher })(requestFor(["e4"]));
    const input = calls[0].body.input as string;
    expect(input).toContain("Side to move: black");
    expect(input).toContain("8 r n b q k b n r");
    expect(input).toContain("Moves so far: 1. e4");
  });

  it("plays the move with the most support across both orderings", async () => {
    const { fetcher } = fakeFetch(() =>
      respond(answer("a", "a2a3", { a2a3: 0.4, g1f3: 0.35 }), answer("b", "g1f3", { g1f3: 0.5, a2a3: 0.2 })),
    );
    expect(await openAiDecisionsAdapter("k", { fetch: fetcher })(requestFor())).toEqual({ kind: "move", san: "Nf3" });
  });

  it("reports the input tokens the call was billed for", async () => {
    const { fetcher } = fakeFetch(() => json({ answers: [answer("a", "e2e4"), answer("b", "e2e4")], usage: { input_tokens: 401, output_tokens: 0 } }));
    expect(await openAiDecisionsAdapter("k", { fetch: fetcher })(requestFor())).toEqual({ kind: "move", san: "e4", inputTokens: 401 });
  });

  it("uses the same one-move tactics as Jev: mate in one needs no call", async () => {
    const { fetcher, calls } = fakeFetch(() => respond());
    const result = await openAiDecisionsAdapter("k", { fetch: fetcher })(requestFor(["f3", "e5", "g4"]));
    expect(result).toEqual({ kind: "move", san: "Qh4#" });
    expect(calls).toHaveLength(0);
  });

  it("treats a refusal as a provider error", async () => {
    const { fetcher } = fakeFetch(() => respond({ type: "refusal", name: "a" }, { type: "refusal", name: "b" }));
    expect((await openAiDecisionsAdapter("k", { fetch: fetcher })(requestFor())).kind).toBe("provider_error");
  });

  it("maps HTTP failures to provider errors", async () => {
    const { fetcher } = fakeFetch(() => json({ error: { message: "bad key" } }, 401));
    expect(await openAiDecisionsAdapter("k", { fetch: fetcher })(requestFor())).toEqual({
      kind: "provider_error", message: "HTTP 401",
    });
  });
});

describe("testOpenAiKey", () => {
  it("accepts a key the API accepts and rejects one it refuses", async () => {
    const good = fakeFetch(() => json({ data: [] }));
    expect(await testOpenAiKey("k", good.fetcher)).toBe(true);
    expect(good.calls[0].url).toBe("https://api.openai.com/v1/models");
    const bad = fakeFetch(() => json({}, 401));
    expect(await testOpenAiKey("k", bad.fetcher)).toBe(false);
  });
});
