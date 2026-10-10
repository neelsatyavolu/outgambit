import { describe, expect, it } from "vitest";
import { requestFor } from "@/test/ai";
import { fakeAdapter } from "./fake";

describe("fakeAdapter", () => {
  it("plays its script in order, one entry per AI move", async () => {
    const adapter = fakeAdapter(["e5", "Qh4#"]);
    expect(await adapter(requestFor(["f3"]))).toEqual({ kind: "move", san: "e5" });
    expect(await adapter(requestFor(["f3", "e5", "g4"]))).toEqual({ kind: "move", san: "Qh4#" });
  });

  it("plays the first legal move when the script runs out or does not fit", async () => {
    const first = requestFor(["e4"]).legalMoves[0].san;
    expect(await fakeAdapter([])(requestFor(["e4"]))).toEqual({ kind: "move", san: first });
    expect(await fakeAdapter(["Qh4#"])(requestFor(["e4"]))).toEqual({ kind: "move", san: first });
  });
});
