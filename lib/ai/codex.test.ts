import { describe, expect, it } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { codexAdapter } from "./codex";

const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: 0, accountId: "acct-1" };
const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });

describe("codexAdapter", () => {
  it("calls the ChatGPT responses endpoint with the account header", async () => {
    const { fetcher, calls } = fakeFetch(() => sse({ type: "response.output_text.done", text: "e4" }));
    await codexAdapter(tokens, fetcher)(requestFor([], { effort: "medium" }));
    expect(calls[0].url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(calls[0].headers.authorization).toBe("Bearer at");
    expect(calls[0].headers["chatgpt-account-id"]).toBe("acct-1");
    expect(calls[0].body).toMatchObject({ model: "model-x", reasoning: { effort: "medium" }, store: false, stream: true });
    expect(calls[0].body.instructions).toContain("as white");
  });

  it("omits the account header when there is no account id", async () => {
    const { fetcher, calls } = fakeFetch(() => sse({ type: "response.output_text.done", text: "e4" }));
    await codexAdapter({ ...tokens, accountId: undefined }, fetcher)(requestFor());
    expect(calls[0].headers).not.toHaveProperty("chatgpt-account-id");
  });

  it("assembles the move from streamed deltas", async () => {
    const { fetcher } = fakeFetch(() => sse({ type: "response.output_text.delta", delta: "N" }, { type: "response.output_text.delta", delta: "f3" }));
    expect(await codexAdapter(tokens, fetcher)(requestFor())).toEqual({ kind: "move", san: "Nf3" });
  });

  it("prefers the final text event over the deltas", async () => {
    const { fetcher } = fakeFetch(() => sse({ delta: "e" }, { type: "response.output_text.done", text: "d4" }));
    expect(await codexAdapter(tokens, fetcher)(requestFor())).toEqual({ kind: "move", san: "d4" });
  });

  it("reports an illegal reply", async () => {
    const { fetcher } = fakeFetch(() => sse({ type: "response.output_text.done", text: "Ke2" }));
    expect(await codexAdapter(tokens, fetcher)(requestFor())).toEqual({ kind: "invalid", raw: "Ke2" });
  });

  it("maps an error event in the stream to a provider error", async () => {
    const { fetcher } = fakeFetch(() => sse({ type: "error", error: { message: "usage limit reached" } }));
    expect(await codexAdapter(tokens, fetcher)(requestFor())).toEqual({ kind: "provider_error", message: "stream error" });
  });

  it("maps HTTP failures to provider errors", async () => {
    const { fetcher } = fakeFetch(() => json({ error: { message: "nope" } }, 401));
    expect(await codexAdapter(tokens, fetcher)(requestFor())).toEqual({ kind: "provider_error", message: "HTTP 401" });
  });
});
