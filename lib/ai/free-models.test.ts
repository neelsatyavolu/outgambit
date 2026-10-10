import { describe, expect, it } from "vitest";
import { fakeFetch, json } from "@/test/ai";
import { GEMINI_FREE_MODELS, freeModelRule, isFreeModel, openRouterFreeModels } from "./free-models";

describe("isFreeModel", () => {
  it("accepts only OpenRouter's free variants", () => {
    expect(isFreeModel("openrouter", "nvidia/nemotron-3.5-lightning:free")).toBe(true);
    expect(isFreeModel("openrouter", "openrouter/free")).toBe(true);
    expect(isFreeModel("openrouter", "openai/gpt-6-astra")).toBe(false);
    expect(isFreeModel("openrouter", "nvidia/nemotron-3.5-lightning")).toBe(false);
    expect(isFreeModel("openrouter", "x/y:free:extended")).toBe(false);
  });

  it("accepts only the Gemini models that have a free tier", () => {
    for (const model of GEMINI_FREE_MODELS) expect(isFreeModel("gemini", model.id)).toBe(true);
    expect(isFreeModel("gemini", "gemini-3.8-flash")).toBe(true);
    expect(isFreeModel("gemini", "gemini-3.1-pro-preview")).toBe(false);
    expect(isFreeModel("gemini", "gemini-omni-1.1-flash")).toBe(false);
    expect(isFreeModel("gemini", "gemini-9-flash")).toBe(false);
  });

  it("does not restrict the other providers", () => {
    expect(isFreeModel("codex", "gpt-6-astra")).toBe(true);
    expect(isFreeModel("jev", "jev-latest")).toBe(true);
  });

  it("explains the rule for each restricted provider", () => {
    expect(freeModelRule("openrouter")).toMatch(/:free/);
    expect(freeModelRule("gemini")).toContain("gemini-3.8-flash");
  });
});

describe("openRouterFreeModels", () => {
  const listing = {
    data: [
      { id: "a/one:free", name: "A: One (free)", supported_parameters: ["reasoning", "tools"] },
      { id: "b/two:free", name: "B: Two (free)", supported_parameters: ["tools"] },
      { id: "c/paid", name: "C: Paid", pricing: { prompt: "0.000001" } },
      { id: "d/promo", name: "D: Promo", pricing: { prompt: "0", completion: "0" } },
    ],
  };

  it("lists the free variants with a clean label and whether they take effort", async () => {
    const { fetcher, calls } = fakeFetch(() => json(listing));
    expect(await openRouterFreeModels(fetcher)).toEqual([
      { id: "a/one:free", label: "A: One", supportsEffort: true },
      { id: "b/two:free", label: "B: Two", supportsEffort: false },
    ]);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/models");
  });

  it("returns nothing when the list cannot be loaded", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await openRouterFreeModels(down)).toEqual([]);
    const { fetcher } = fakeFetch(() => json({ error: "x" }, 500));
    expect(await openRouterFreeModels(fetcher)).toEqual([]);
  });
});
