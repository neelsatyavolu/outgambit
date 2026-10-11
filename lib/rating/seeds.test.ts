import { describe, expect, it } from "vitest";
import { modelKey, seedRating } from "./seeds";

describe("modelKey", () => {
  it("names a model, and its effort when it has one", () => {
    expect(modelKey("codex", "gpt-6-astra", "high")).toBe("codex/gpt-6-astra#high");
    expect(modelKey("jev", "jev-latest", null)).toBe("jev/jev-latest");
  });
});

describe("seedRating", () => {
  it("rates more effort higher for the same model", () => {
    const [low, medium, high] = (["low", "medium", "high"] as const).map((e) => seedRating("codex", "gpt-6-astra", e, "regular"));
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("rates the flagship above the fast model", () => {
    expect(seedRating("codex", "gpt-6-astra", "medium", "regular")).toBeGreaterThan(
      seedRating("codex", "gpt-6-luna", "medium", "regular"),
    );
  });

  it("rates the decision models higher at bullet, where an instant reply is worth more", () => {
    for (const [provider, model] of [["jev", "jev-latest"], ["mercury", "mercury-decide"], ["openai", "gpt-6-luna"], ["gateway", "liquid/d1"]] as const) {
      expect(seedRating(provider, model, null, "bullet")).toBeGreaterThan(seedRating(provider, model, null, "regular"));
    }
  });

  it("gives an unknown model a modest default instead of failing", () => {
    expect(seedRating("openrouter", "someone/new-model:free", null, "regular")).toBe(600);
    expect(seedRating("codex", "gpt-9-future", "medium", "regular")).toBe(1000);
  });

  it("stays within a believable range for every known model", () => {
    const all = [
      seedRating("codex", "gpt-6-astra", "high", "regular"), seedRating("grok", "grok-4.7", "high", "regular"),
      seedRating("gemini", "gemini-3.8-flash", "high", "regular"), seedRating("gemini", "gemini-3.1-flash-lite", null, "regular"),
      seedRating("jev", "jev-latest", null, "bullet"),
    ];
    for (const rating of all) {
      expect(rating).toBeGreaterThanOrEqual(400);
      expect(rating).toBeLessThanOrEqual(1500);
    }
  });
});
