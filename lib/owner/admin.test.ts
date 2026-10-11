import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeFetch, json } from "@/test/ai";
import { resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { getConnection } from "../db/connections";
import {
  addCustomModel, connectionStatus, removeCustomModel, saveApiKey, setModelEnabled, suggestedFreeModels,
  testConnection,
} from "./admin";
import { upsertModel } from "../db/models";
import { listForOwner } from "./catalog";
import { readSecret, saveSecret } from "./credentials";

const NOW = 1_800_000_000_000;
const loadCatalog = async () => ({ codex: [{ id: "gpt-a", label: "GPT A" }], grok: [{ id: "grok-a", label: "Grok A" }] });
const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: NOW + 3_600_000 };

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

describe("connectionStatus", () => {
  it("lists every provider and how each one connects", async () => {
    await saveSecret(db, "jev", { kind: "key", apiKey: "k" }, NOW);
    const status = await connectionStatus(db);
    expect(status.map((c) => [c.provider, c.label, c.kind, c.connected, c.updatedAt])).toEqual([
      ["codex", "ChatGPT", "oauth", false, null],
      ["grok", "Grok", "oauth", false, null],
      ["gemini", "Gemini", "key", false, null],
      ["openrouter", "OpenRouter", "key", false, null],
      ["jev", "Jev (TypeSafe)", "key", true, NOW],
      ["openai", "OpenAI Decisions", "key", false, null],
      ["gateway", "Vercel AI Gateway", "key", false, null],
    ]);
    // Each one says what using it costs, so the owner can choose knowingly.
    expect(status.every((c) => c.note.length > 0)).toBe(true);
    expect(status.find((c) => c.provider === "openrouter")?.note).toMatch(/free/i);

  });
});

describe("saveApiKey", () => {
  it("stores a trimmed key, encrypted", async () => {
    expect(await saveApiKey(db, "gemini", "  g-key  ", NOW)).toBe(true);
    const stored = await getConnection(db, "gemini");
    expect(stored?.secret).not.toContain("g-key");
    expect(readSecret(stored!.secret)).toEqual({ kind: "key", apiKey: "g-key" });
  });

  it("refuses a key for a provider that signs in instead", async () => {
    expect(await saveApiKey(db, "codex", "k", NOW)).toBe(false);
    expect(await getConnection(db, "codex")).toBeNull();
  });
});

describe("testConnection", () => {
  it("reports a provider that is not connected", async () => {
    expect(await testConnection(db, "gemini", NOW)).toEqual({ ok: false, error: "Not connected." });
  });

  it("checks a Gemini key against the models endpoint", async () => {
    await saveSecret(db, "gemini", { kind: "key", apiKey: "g-key" }, NOW);
    const { fetcher, calls } = fakeFetch(() => json({ data: [] }));
    expect(await testConnection(db, "gemini", NOW, fetcher)).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
    expect(calls[0].headers.authorization).toBe("Bearer g-key");
  });

  it("checks an OpenRouter key", async () => {
    await saveSecret(db, "openrouter", { kind: "key", apiKey: "or-key" }, NOW);
    const { fetcher, calls } = fakeFetch(() => json({ data: {} }));
    expect(await testConnection(db, "openrouter", NOW, fetcher)).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/key");
  });

  it("checks an OpenAI key and an AI Gateway key", async () => {
    await saveSecret(db, "openai", { kind: "key", apiKey: "sk-key" }, NOW);
    await saveSecret(db, "gateway", { kind: "key", apiKey: "vck-key" }, NOW);
    const { fetcher, calls } = fakeFetch(() => json({ data: [] }));
    expect(await testConnection(db, "openai", NOW, fetcher)).toEqual({ ok: true });
    expect(await testConnection(db, "gateway", NOW, fetcher)).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(["https://api.openai.com/v1/models", "https://ai-gateway.vercel.sh/v1/credits"]);
    expect(calls[1].headers.authorization).toBe("Bearer vck-key");
  });

  it("checks a TypeSafe key", async () => {
    await saveSecret(db, "jev", { kind: "key", apiKey: "ts-key" }, NOW);
    const { fetcher } = fakeFetch(() => json({ answers: {} }));
    expect(await testConnection(db, "jev", NOW, fetcher)).toEqual({ ok: true });
  });

  it("reports a key the provider refuses, without echoing its response", async () => {
    await saveSecret(db, "gemini", { kind: "key", apiKey: "bad" }, NOW);
    const { fetcher } = fakeFetch(() => json({ error: "secret detail" }, 401));
    expect(await testConnection(db, "gemini", NOW, fetcher)).toEqual({ ok: false, error: "The provider answered HTTP 401." });
  });

  it("reports a network failure", async () => {
    await saveSecret(db, "gemini", { kind: "key", apiKey: "k" }, NOW);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await testConnection(db, "gemini", NOW, down)).toEqual({ ok: false, error: "Could not reach the provider." });
  });

  it("accepts a sign-in whose tokens are still valid", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens }, NOW);
    expect(await testConnection(db, "codex", NOW)).toEqual({ ok: true });
  });
});

describe("models", () => {
  it("switches a catalog model on and off", async () => {
    expect(await setModelEnabled(db, "codex", "gpt-a", true, loadCatalog)).toBe(true);
    expect((await listForOwner(db, loadCatalog)).find((m) => m.id === "gpt-a")?.enabled).toBe(true);
    await setModelEnabled(db, "codex", "gpt-a", false, loadCatalog);
    expect((await listForOwner(db, loadCatalog)).find((m) => m.id === "gpt-a")?.enabled).toBe(false);
  });

  it("switches Jev off", async () => {
    await setModelEnabled(db, "jev", "jev-latest", false, loadCatalog);
    expect((await listForOwner(db, loadCatalog)).find((m) => m.provider === "jev")?.enabled).toBe(false);
  });

  it("refuses to switch a model that does not exist", async () => {
    expect(await setModelEnabled(db, "codex", "made-up", true, loadCatalog)).toBe(false);
  });

  it("adds a hand-entered free model, switched on, and keeps its details when toggled", async () => {
    const model = { provider: "openrouter", id: " x/y:free ", label: " Y ", supportsEffort: true } as const;
    expect(await addCustomModel(db, model)).toEqual({ ok: true });
    await setModelEnabled(db, "openrouter", "x/y:free", false, loadCatalog);
    expect((await listForOwner(db, loadCatalog)).find((m) => m.id === "x/y:free")).toMatchObject({
      label: "Y", supportsEffort: true, enabled: false, custom: true,
    });
  });

  it("refuses a hand-entered model for a provider with a catalog", async () => {
    const result = await addCustomModel(db, { provider: "codex", id: "gpt-z", label: "Z", supportsEffort: true });
    expect(result).toEqual({ ok: false, error: "Models can only be added for Gemini and OpenRouter." });
  });

  it("refuses an OpenRouter model that is not a free variant, and stores nothing", async () => {
    const result = await addCustomModel(db, { provider: "openrouter", id: "openai/gpt-6-astra", label: "Astra", supportsEffort: true });
    expect(result).toEqual({ ok: false, error: expect.stringContaining(":free") });
    expect((await listForOwner(db, loadCatalog)).some((m) => m.id === "openai/gpt-6-astra")).toBe(false);
  });

  it("refuses a Gemini model that has no free tier", async () => {
    const result = await addCustomModel(db, { provider: "gemini", id: "gemini-3.1-pro-preview", label: "Pro", supportsEffort: true });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("free tier") });
  });

  it("refuses to switch on a stored model that is not free", async () => {
    await upsertModel(db, { provider: "openrouter", modelId: "openai/gpt-6-astra", label: "Paid", supportsEffort: true, enabled: false });
    expect(await setModelEnabled(db, "openrouter", "openai/gpt-6-astra", true, loadCatalog)).toBe(false);
  });

  it("removes a hand-entered model but not a catalog one", async () => {
    await addCustomModel(db, { provider: "gemini", id: "gemini-3.8-flash", label: "Flash", supportsEffort: true });
    expect(await removeCustomModel(db, "gemini", "gemini-3.8-flash")).toBe(true);
    expect((await listForOwner(db, loadCatalog)).some((m) => m.id === "gemini-3.8-flash")).toBe(false);
    expect(await removeCustomModel(db, "codex", "gpt-a")).toBe(false);
  });
});

describe("suggestedFreeModels", () => {
  const openRouter = async () => [
    { id: "a/one:free", label: "A: One", supportsEffort: true },
    { id: "b/two:free", label: "B: Two", supportsEffort: false },
  ];

  it("suggests the free Gemini models and OpenRouter's current free models", async () => {
    const suggestions = await suggestedFreeModels(db, openRouter);
    expect(suggestions.filter((m) => m.provider === "gemini").map((m) => m.id)).toContain("gemini-3.8-flash");
    expect(suggestions.filter((m) => m.provider === "openrouter")).toEqual([
      { provider: "openrouter", id: "a/one:free", label: "A: One", supportsEffort: true },
      { provider: "openrouter", id: "b/two:free", label: "B: Two", supportsEffort: false },
    ]);
  });

  it("leaves out models that have already been added", async () => {
    await addCustomModel(db, { provider: "openrouter", id: "a/one:free", label: "A: One", supportsEffort: true });
    await addCustomModel(db, { provider: "gemini", id: "gemini-3.8-flash", label: "Flash", supportsEffort: true });
    const ids = (await suggestedFreeModels(db, openRouter)).map((m) => m.id);
    expect(ids).not.toContain("a/one:free");
    expect(ids).not.toContain("gemini-3.8-flash");
    expect(ids).toContain("b/two:free");
  });
});
