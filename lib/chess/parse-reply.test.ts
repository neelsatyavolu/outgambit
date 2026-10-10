import { describe, expect, it } from "vitest";
import { parseReply } from "./parse-reply";
import { replay } from "./rules";

const start = replay([]).legal;
const afterE4 = replay(["e4"]).legal;
const parse = (raw: string, legal = start) => parseReply(raw, legal)?.san ?? null;

describe("parseReply", () => {
  it("reads a bare SAN move", () => {
    expect(parse("Nf3")).toBe("Nf3");
  });

  it("reads a UCI move", () => {
    expect(parse("e2e4")).toBe("e4");
  });

  it("reads a move wrapped in markdown", () => {
    expect(parse("**Nf3**")).toBe("Nf3");
    expect(parse("`e4`")).toBe("e4");
  });

  it("reads a move with a move number", () => {
    expect(parse("1. e4")).toBe("e4");
    expect(parse("1... e5", afterE4)).toBe("e5");
    expect(parse("1...e5", afterE4)).toBe("e5");
  });

  it("reads a move inside a sentence", () => {
    expect(parse("I'll play e2e4.")).toBe("e4");
    expect(parse("My move is Nf3!")).toBe("Nf3");
  });

  it("ignores surrounding whitespace and newlines", () => {
    expect(parse("\n  d4 \n")).toBe("d4");
  });

  it("accepts a hyphenated long move", () => {
    expect(parse("e2-e4")).toBe("e4");
  });

  it("rejects a reply naming two different legal moves", () => {
    expect(parse("Either e4 or d4 works.")).toBeNull();
  });

  it("accepts the same move written twice", () => {
    expect(parse("e4 (e2e4)")).toBe("e4");
  });

  it("rejects a move that is not legal here", () => {
    expect(parse("Qh5")).toBeNull();
    expect(parse("e5")).toBeNull();
  });

  it("rejects an empty or wordy reply with no move", () => {
    expect(parse("")).toBeNull();
    expect(parse("I resign.")).toBeNull();
  });

  it("matches SAN without its check mark, and with a stray one", () => {
    const legal = replay(["f3", "e5", "g4"]).legal;
    expect(parse("Qh4", legal)).toBe("Qh4#");
    expect(parse("Qh4+", legal)).toBe("Qh4#");
  });

  it("reads castling written with zeros", () => {
    const legal = replay(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]).legal;
    expect(parse("0-0", legal)).toBe("O-O");
    expect(parse("O-O", legal)).toBe("O-O");
  });

  it("reads promotion with and without the equals sign", () => {
    const legal = replay(["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6"]).legal;
    expect(parse("bxa8=Q", legal)).toBe("bxa8=Q");
    expect(parse("bxa8Q", legal)).toBe("bxa8=Q");
    expect(parse("b7a8n", legal)).toBe("bxa8=N");
  });

  it("reads a piece capture when a pawn can capture on the same square", () => {
    // Both Bxc3 and dxc3 are legal for white here.
    const legal = replay(["b3", "d5", "Bb2", "d4", "Nc3", "dxc3"]).legal;
    expect(parse("Bxc3", legal)).toBe("Bxc3");
  });

  it("falls back to ignoring case when nothing else matches", () => {
    expect(parse("nf3")).toBe("Nf3");
    expect(parse("E4")).toBe("e4");
  });
});
