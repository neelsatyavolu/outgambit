import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFetch, json, requestFor } from "@/test/ai";
import { resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { saveSecret } from "../owner/credentials";
import { getAdapter } from "./registry";

const NOW = 1_800_000_000_000;
const tokens = { accessToken: "oauth-at", refreshToken: "rt", expiresAt: NOW + 3_600_000 };
const reply = () => json({ choices: [{ message: { content: "e4" } }] });

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));
afterEach(() => vi.unstubAllEnvs());

describe("getAdapter", () => {
  it("returns null for a provider that is not connected", async () => {
    expect(await getAdapter(db, "gemini", NOW)).toBeNull();
  });

  it("calls Gemini's OpenAI-compatible endpoint with reasoning_effort", async () => {
    await saveSecret(db, "gemini", { kind: "key", apiKey: "g-key" }, NOW);
    const { fetcher, calls } = fakeFetch(reply);
    const adapter = await getAdapter(db, "gemini", NOW, fetcher);
    await adapter!(requestFor([], { effort: "high", model: "gemini-3.8-flash" }));
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer g-key");
    expect(calls[0].body.reasoning_effort).toBe("high");
  });

  it("calls OpenRouter with a reasoning object", async () => {
    await saveSecret(db, "openrouter", { kind: "key", apiKey: "or-key" }, NOW);
    const { fetcher, calls } = fakeFetch(reply);
    await (await getAdapter(db, "openrouter", NOW, fetcher))!(requestFor([], { effort: "low", model: "x/y:free" }));
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].body.reasoning).toEqual({ effort: "low" });
  });

  it("never sends a paid model to OpenRouter or Gemini, whatever the game says", async () => {
    await saveSecret(db, "openrouter", { kind: "key", apiKey: "or-key" }, NOW);
    await saveSecret(db, "gemini", { kind: "key", apiKey: "g-key" }, NOW);
    const { fetcher, calls } = fakeFetch(reply);
    const paid = [
      await (await getAdapter(db, "openrouter", NOW, fetcher))!(requestFor([], { model: "openai/gpt-6-astra" })),
      await (await getAdapter(db, "gemini", NOW, fetcher))!(requestFor([], { model: "gemini-3.1-pro-preview" })),
    ];
    expect(paid).toEqual([
      { kind: "provider_error", message: "not a free model" },
      { kind: "provider_error", message: "not a free model" },
    ]);
    expect(calls).toHaveLength(0);
  });

  it("calls Grok with the signed-in access token", async () => {
    await saveSecret(db, "grok", { kind: "oauth", tokens }, NOW);
    const { fetcher, calls } = fakeFetch(reply);
    await (await getAdapter(db, "grok", NOW, fetcher))!(requestFor([], { effort: "medium" }));
    expect(calls[0].url).toBe("https://api.x.ai/v1/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer oauth-at");
    expect(calls[0].body.reasoning).toEqual({ effort: "medium" });
  });

  it("calls ChatGPT with the signed-in access token", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens }, NOW);
    const { fetcher, calls } = fakeFetch(() => new Response('data: {"type":"response.output_text.done","text":"e4"}\n\n'));
    await (await getAdapter(db, "codex", NOW, fetcher))!(requestFor());
    expect(calls[0].url).toBe("https://chatgpt.com/backend-api/codex/responses");
  });

  it("calls Jev with the TypeSafe key", async () => {
    await saveSecret(db, "jev", { kind: "key", apiKey: "ts-key" }, NOW);
    const { fetcher, calls } = fakeFetch(() => json({ answers: { move: { choice: "e2e4" } } }));
    expect(await (await getAdapter(db, "jev", NOW, fetcher))!(requestFor())).toEqual({ kind: "move", san: "e4" });
    expect(calls[0].headers.authorization).toBe("Bearer ts-key");
  });

  it("offers the scripted opponent only when it is switched on", async () => {
    expect(await getAdapter(db, "fake", NOW)).toBeNull();
    vi.stubEnv("GAMBIT_FAKE_AI", "1");
    vi.stubEnv("GAMBIT_FAKE_SCRIPT", "e5,Qh4#");
    const adapter = await getAdapter(db, "fake", NOW);
    expect(await adapter!(requestFor(["f3"]))).toEqual({ kind: "move", san: "e5" });
  });

  it("never offers the scripted opponent in production", async () => {
    vi.stubEnv("GAMBIT_FAKE_AI", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await getAdapter(db, "fake", NOW)).toBeNull();
  });
});
