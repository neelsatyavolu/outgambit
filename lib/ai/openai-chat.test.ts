import { describe, expect, it } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { chatAdapter } from "./openai-chat";

const reply = (content: unknown) => json({ choices: [{ message: { content } }] });
const base = { url: "https://example.test/v1/chat/completions", apiKey: "k-1" };

describe("chatAdapter", () => {
  it("sends the model, the prompt and the bearer key", async () => {
    const { fetcher, calls } = fakeFetch(() => reply("e4"));
    await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor());
    expect(calls[0].url).toBe(base.url);
    expect(calls[0].headers.authorization).toBe("Bearer k-1");
    expect(calls[0].body.model).toBe("model-x");
    expect(calls[0].body.messages).toEqual([
      { role: "system", content: expect.stringContaining("as white") },
      { role: "user", content: expect.stringContaining("Legal moves:") },
    ]);
  });

  it("sends effort as a reasoning object", async () => {
    const { fetcher, calls } = fakeFetch(() => reply("e4"));
    await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor([], { effort: "high" }));
    expect(calls[0].body.reasoning).toEqual({ effort: "high" });
  });

  it("sends effort as reasoning_effort where the provider wants that", async () => {
    const { fetcher, calls } = fakeFetch(() => reply("e4"));
    await chatAdapter({ ...base, effortField: "reasoning_effort", fetch: fetcher })(requestFor([], { effort: "low" }));
    expect(calls[0].body.reasoning_effort).toBe("low");
    expect(calls[0].body.reasoning).toBeUndefined();
  });

  it("sends no effort field when none was chosen", async () => {
    const { fetcher, calls } = fakeFetch(() => reply("e4"));
    await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor());
    expect(calls[0].body).not.toHaveProperty("reasoning");
  });

  it("adds extra headers", async () => {
    const { fetcher, calls } = fakeFetch(() => reply("e4"));
    await chatAdapter({ ...base, effortField: "reasoning", headers: { "User-Agent": "x/1" }, fetch: fetcher })(requestFor());
    expect(calls[0].headers["user-agent"]).toBe("x/1");
  });

  it("returns the move the model named", async () => {
    const { fetcher } = fakeFetch(() => reply("**Nf3**"));
    expect(await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor())).toEqual({
      kind: "move",
      san: "Nf3",
    });
  });

  it("reports a reply that is not a legal move", async () => {
    const { fetcher } = fakeFetch(() => reply("Qh5"));
    expect(await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor())).toEqual({
      kind: "invalid",
      raw: "Qh5",
    });
  });

  it("treats an empty or non-text reply as invalid", async () => {
    for (const content of ["", null, [{ type: "text" }]]) {
      const { fetcher } = fakeFetch(() => reply(content));
      const result = await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor());
      expect(result.kind).toBe("invalid");
    }
  });

  it("maps HTTP failures to provider errors", async () => {
    for (const status of [401, 429, 500]) {
      const { fetcher } = fakeFetch(() => json({ error: { message: "secret detail" } }, status));
      const result = await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor());
      expect(result).toEqual({ kind: "provider_error", message: `HTTP ${status}` });
    }
  });

  it("maps a network failure or timeout to a provider error", async () => {
    const fetcher = (async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    const result = await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor());
    expect(result).toEqual({ kind: "provider_error", message: "TimeoutError" });
  });

  it("maps a body that is not JSON to a provider error", async () => {
    const { fetcher } = fakeFetch(() => new Response("<html>", { status: 200 }));
    const result = await chatAdapter({ ...base, effortField: "reasoning", fetch: fetcher })(requestFor());
    expect(result.kind).toBe("provider_error");
  });
});
