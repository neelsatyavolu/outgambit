import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeFetch, json } from "@/test/ai";
import { resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { getConnection } from "../db/connections";
import { addCustomModel, connectionStatus, removeCustomModel, saveApiKey, setModelEnabled, testConnection } from "./admin";
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
  it("lists all five providers and how each one connects", async () => {
    await saveSecret(db, "jev", { kind: "key", apiKey: "k" }, NOW);
    expect(await connectionStatus(db)).toEqual([
      { provider: "codex", label: "ChatGPT", kind: "oauth", connected: false, updatedAt: null },
      { provider: "grok", label: "Grok", kind: "oauth", connected: false, updatedAt: null },
      { provider: "gemini", label: "Gemini", kind: "key", connected: false, updatedAt: null },
      { provider: "openrouter", label: "OpenRouter", kind: "key", connected: false, updatedAt: null },
      { provider: "jev", label: "Jev (TypeSafe)", kind: "key", connected: true, updatedAt: NOW },
    ]);
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

  it("adds a hand-entered model, switched on, and keeps its details when toggled", async () => {
    const model = { provider: "openrouter", id: " x/y:free ", label: " Y ", supportsEffort: true } as const;
    expect(await addCustomModel(db, model)).toBe(true);
    await setModelEnabled(db, "openrouter", "x/y:free", false, loadCatalog);
    expect((await listForOwner(db, loadCatalog)).find((m) => m.id === "x/y:free")).toMatchObject({
      label: "Y", supportsEffort: true, enabled: false, custom: true,
    });
  });

  it("refuses a hand-entered model for a provider with a catalog", async () => {
    expect(await addCustomModel(db, { provider: "codex", id: "gpt-z", label: "Z", supportsEffort: true })).toBe(false);
  });

  it("removes a hand-entered model but not a catalog one", async () => {
    await addCustomModel(db, { provider: "gemini", id: "gem-1", label: "Gem", supportsEffort: false });
    expect(await removeCustomModel(db, "gemini", "gem-1")).toBe(true);
    expect((await listForOwner(db, loadCatalog)).some((m) => m.id === "gem-1")).toBe(false);
    expect(await removeCustomModel(db, "codex", "gpt-a")).toBe(false);
  });
});
