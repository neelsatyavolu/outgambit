import { describe, expect, it } from "vitest";
import { centsPerMillionTokens, effortFor, effortsFor, findTimeControl, timeControlsFor } from "./config";

describe("efforts", () => {
  it("offers only low", () => {
    expect(effortsFor("codex", "gpt-6-astra")).toEqual(["low"]);
    expect(effortsFor("grok", "grok-4.7")).toEqual(["low"]);
    expect(effortsFor("gemini", "gemini-3.8-flash")).toEqual(["low"]);
    expect(effortsFor("openrouter", "apodex/apodex-1.1-mini:free")).toEqual(["low"]);
  });

  it("plays at low even when a higher effort is asked for", () => {
    expect(effortFor("codex", "gpt-6-astra", "low")).toBe("low");
    expect(effortFor("codex", "gpt-6-astra", "high")).toBe("low");
    expect(effortFor("gemini", "gemini-3.8-flash", "medium")).toBe("low");
  });
});

describe("time controls", () => {
  it("offers LLM providers only the two slowest controls", () => {
    for (const provider of ["codex", "grok", "gemini", "openrouter"] as const) {
      expect(timeControlsFor(provider).map((t) => t.id)).toEqual(["20+20", "45+30"]);
    }
  });

  it("offers decision models one-minute games and nothing else", () => {
    for (const provider of ["jev", "mercury", "subq", "openai", "gateway"] as const) {
      expect(timeControlsFor(provider).map((t) => t.id)).toEqual(["1+0"]);
    }
  });

  it("offers the scripted opponent every control", () => {
    expect(timeControlsFor("fake").map((t) => t.id)).toEqual(["1+0", "2+1", "3+0", "5+0", "10+10", "20+20", "45+30"]);
  });

  it("converts a control to milliseconds", () => {
    expect(findTimeControl("2+1")).toMatchObject({ initialMs: 120_000, incrementMs: 1_000 });
  });

  it("returns undefined for an unknown control", () => {
    expect(findTimeControl("0+0")).toBeUndefined();
  });
});

describe("prices", () => {
  it("knows what each paid model charges for a million input tokens, in cents", () => {
    expect(centsPerMillionTokens("jev", "jev-latest")).toBe(4.2);
    expect(centsPerMillionTokens("mercury", "mercury-decide")).toBe(2);
    expect(centsPerMillionTokens("subq", "subq-snap-preview")).toBe(5);
    expect(centsPerMillionTokens("openai", "gpt-6-luna")).toBe(10);
    expect(centsPerMillionTokens("gateway", "liquid/d1")).toBe(4);
  });

  it("charges a model it has no price for at the dearest one", () => {
    expect(centsPerMillionTokens("gateway", "someone/new")).toBe(10);
  });
});
