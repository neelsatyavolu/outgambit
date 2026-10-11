import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { upsertModel } from "../db/models";
import { findOffered, listForOwner, listOffered } from "./catalog";
import { saveSecret } from "./credentials";

const NOW = 1_800_000_000_000;
const catalog = {
  version: 1 as const,
  codex: [{ id: "gpt-a", label: "GPT A" }],
  grok: [{ id: "grok-a", label: "Grok A" }],
};
const loadCatalog = async () => catalog;
const key = { kind: "key", apiKey: "k" } as const;
const oauth = { kind: "oauth", tokens: { accessToken: "a", refreshToken: "r", expiresAt: NOW + 3_600_000 } } as const;

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));
afterEach(() => vi.unstubAllEnvs());

describe("listForOwner", () => {
  it("lists catalog models as switched off until the owner enables them", async () => {
    const models = await listForOwner(db, loadCatalog);
    expect(models.find((m) => m.id === "gpt-a")).toEqual({
      provider: "codex", id: "gpt-a", label: "GPT A", supportsEffort: true, enabled: false, connected: false, custom: false,
    });
  });

  it("shows a catalog model as enabled once it has been switched on", async () => {
    await upsertModel(db, { provider: "codex", modelId: "gpt-a", label: "GPT A", supportsEffort: true, enabled: true });
    expect((await listForOwner(db, loadCatalog)).find((m) => m.id === "gpt-a")?.enabled).toBe(true);
  });

  it("ignores a saved row for a model the catalog no longer has", async () => {
    await upsertModel(db, { provider: "codex", modelId: "gpt-old", label: "Old", supportsEffort: true, enabled: true });
    expect((await listForOwner(db, loadCatalog)).some((m) => m.id === "gpt-old")).toBe(false);
  });

  it("lists Jev as on by default, without effort", async () => {
    expect((await listForOwner(db, loadCatalog)).find((m) => m.provider === "jev")).toMatchObject({
      id: "jev-latest", label: "Jev", supportsEffort: false, enabled: true, custom: false,
    });
  });

  it("lists the paid decision models as switched off until the owner enables them", async () => {
    const models = await listForOwner(db, loadCatalog);
    expect(models.find((m) => m.provider === "openai")).toMatchObject({
      id: "gpt-6-luna", label: "GPT-6 Luna (Decisions)", supportsEffort: false, enabled: false, custom: false,
    });
    expect(models.filter((m) => m.provider === "gateway").map((m) => [m.id, m.enabled])).toEqual([
      ["liquid/d1", false],
      ["microsoft/microsoft-decision-1", false],
    ]);
  });

  it("gives decision models one-minute games only", async () => {
    await saveSecret(db, "openai", key, NOW);
    await upsertModel(db, { provider: "openai", modelId: "gpt-6-luna", label: "GPT-6 Luna (Decisions)", supportsEffort: false, enabled: true });
    expect((await listOffered(db, loadCatalog)).find((m) => m.provider === "openai")?.timeControls).toEqual(["1+0"]);
  });

  it("lists models the owner added by hand", async () => {
    await upsertModel(db, { provider: "openrouter", modelId: "x/y:free", label: "Y", supportsEffort: false, enabled: true });
    expect((await listForOwner(db, loadCatalog)).find((m) => m.id === "x/y:free")).toMatchObject({ custom: true });
  });

  it("marks which providers are connected", async () => {
    await saveSecret(db, "jev", key, NOW);
    const models = await listForOwner(db, loadCatalog);
    expect(models.find((m) => m.provider === "jev")?.connected).toBe(true);
    expect(models.find((m) => m.provider === "codex")?.connected).toBe(false);
  });

  it("hides the scripted opponent unless it is switched on", async () => {
    expect((await listForOwner(db, loadCatalog)).some((m) => m.provider === "fake")).toBe(false);
    vi.stubEnv("GAMBIT_FAKE_AI", "1");
    expect((await listForOwner(db, loadCatalog)).find((m) => m.provider === "fake")).toMatchObject({
      enabled: true, connected: true,
    });
  });
});

describe("listOffered", () => {
  it("offers only models that are enabled and whose provider is connected", async () => {
    await saveSecret(db, "codex", oauth, NOW);
    await saveSecret(db, "jev", key, NOW);
    await upsertModel(db, { provider: "grok", modelId: "grok-a", label: "Grok A", supportsEffort: true, enabled: true });
    // codex connected but gpt-a not enabled; grok enabled but not connected; jev both.
    expect((await listOffered(db, loadCatalog)).map((m) => m.id)).toEqual(["jev-latest"]);
  });

  it("gives each offered model its time controls", async () => {
    await saveSecret(db, "codex", oauth, NOW);
    await saveSecret(db, "jev", key, NOW);
    await upsertModel(db, { provider: "codex", modelId: "gpt-a", label: "GPT A", supportsEffort: true, enabled: true });
    const offered = await listOffered(db, loadCatalog);
    expect(offered.find((m) => m.id === "gpt-a")?.timeControls).toEqual(["20+20", "45+30"]);
    expect(offered.find((m) => m.id === "jev-latest")?.timeControls).toEqual(["1+0"]);
  });

  it("never offers a stored OpenRouter or Gemini model that is not free", async () => {
    await saveSecret(db, "openrouter", key, NOW);
    await saveSecret(db, "gemini", key, NOW);
    await upsertModel(db, { provider: "openrouter", modelId: "openai/gpt-6-astra", label: "Paid", supportsEffort: true, enabled: true });
    await upsertModel(db, { provider: "openrouter", modelId: "x/y:free", label: "Free", supportsEffort: false, enabled: true });
    await upsertModel(db, { provider: "gemini", modelId: "gemini-3.1-pro-preview", label: "Pro", supportsEffort: true, enabled: true });
    expect((await listOffered(db, loadCatalog)).map((m) => m.id)).toEqual(["x/y:free"]);
  });

  it("offers nothing when every model is off", async () => {
    await saveSecret(db, "jev", key, NOW);
    await upsertModel(db, { provider: "jev", modelId: "jev-latest", label: "Jev", supportsEffort: false, enabled: false });
    expect(await listOffered(db, loadCatalog)).toEqual([]);
  });
});

describe("findOffered", () => {
  it("finds an offered model and nothing else", async () => {
    await saveSecret(db, "jev", key, NOW);
    expect(await findOffered(db, "jev", "jev-latest", loadCatalog)).toMatchObject({ label: "Jev" });
    expect(await findOffered(db, "jev", "other", loadCatalog)).toBeNull();
    expect(await findOffered(db, "codex", "gpt-a", loadCatalog)).toBeNull();
  });
});
