import { describe, expect, it } from "vitest";
import { decrypt, encrypt, sign, verify } from "./crypto";

describe("encrypt", () => {
  it("round-trips text", () => {
    expect(decrypt(encrypt("sk-secret ✓"))).toBe("sk-secret ✓");
  });

  it("does not contain the plain text", () => {
    expect(encrypt("sk-secret")).not.toContain("sk-secret");
  });

  it("produces a different blob each time", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("refuses a blob that was altered", () => {
    const blob = encrypt("sk-secret");
    const flipped = blob.slice(0, -2) + (blob.at(-2) === "A" ? "B" : "A") + blob.slice(-1);
    expect(() => decrypt(flipped)).toThrow();
  });

  it("refuses text that was never encrypted", () => {
    expect(() => decrypt("plain")).toThrow();
  });
});

describe("sign", () => {
  it("verifies its own tokens", () => {
    expect(verify(sign("owner.123"))).toBe("owner.123");
  });

  it("rejects a changed value", () => {
    const token = sign("owner.123");
    expect(verify(token.replace("owner.123", "owner.999"))).toBeNull();
  });

  it("rejects a missing or malformed token", () => {
    expect(verify(undefined)).toBeNull();
    expect(verify("")).toBeNull();
    expect(verify("no-signature")).toBeNull();
  });
});
