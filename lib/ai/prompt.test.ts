import { describe, expect, it } from "vitest";
import { requestFor } from "@/test/ai";
import { buildPrompt } from "./prompt";

describe("buildPrompt", () => {
  it("tells the model its color and to answer with one move only", () => {
    const { system } = buildPrompt(requestFor(["e4"]));
    expect(system).toContain("as black");
    expect(system).toMatch(/exactly one move/i);
  });

  it("includes the position, the moves so far and the time left", () => {
    const { user } = buildPrompt(requestFor(["e4", "e5", "Nf3"]));
    expect(user).toContain("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
    expect(user).toContain("1. e4 e5 2. Nf3");
    expect(user).toContain("9m 42s");
  });

  it("lists every legal move", () => {
    const request = requestFor([]);
    const { user } = buildPrompt(request);
    const listed = user.split("\n").find((line) => line.startsWith("Legal moves:"))!;
    expect(listed.replace("Legal moves: ", "").split(", ")).toEqual(request.legalMoves.map((m) => m.san));
  });

  it("says when no moves have been played", () => {
    expect(buildPrompt(requestFor([])).user).toContain("Moves so far: none");
  });

  it("names the rejected reply on a retry", () => {
    expect(buildPrompt(requestFor([], { rejected: "Qh5" })).user).toContain('"Qh5" is not a legal move');
    expect(buildPrompt(requestFor([])).user).not.toContain("not a legal move");
  });

  it("shows seconds only when under a minute", () => {
    expect(buildPrompt(requestFor([], { remainingMs: 8_400 })).user).toContain("8s");
  });
});
