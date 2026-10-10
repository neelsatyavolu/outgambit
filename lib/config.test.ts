import { describe, expect, it } from "vitest";
import { LIMITS, findTimeControl, timeControlsFor } from "./config";

describe("time controls", () => {
  it("offers LLM providers only the three slow controls", () => {
    for (const provider of ["codex", "grok", "gemini", "openrouter"] as const) {
      expect(timeControlsFor(provider).map((t) => t.id)).toEqual(["10+10", "20+20", "45+30"]);
    }
  });

  it("offers Jev the bullet and blitz controls as well", () => {
    expect(timeControlsFor("jev").map((t) => t.id)).toEqual(["1+0", "2+1", "3+0", "5+0", "10+10", "20+20", "45+30"]);
  });

  it("converts a control to milliseconds", () => {
    expect(findTimeControl("2+1")).toMatchObject({ initialMs: 120_000, incrementMs: 1_000 });
  });

  it("returns undefined for an unknown control", () => {
    expect(findTimeControl("0+0")).toBeUndefined();
  });
});

describe("limits", () => {
  it("matches the agreed daily limits", () => {
    expect(LIMITS).toEqual({ playerPerDay: 5, ipPerDay: 10, globalPerDay: 12 });
  });
});
