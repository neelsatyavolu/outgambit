import { describe, expect, it } from "vitest";
import { sign } from "./crypto";
import { SESSION_TTL_MS, checkPassword, createSession, isValidSession } from "./session";

const NOW = 1_800_000_000_000;

describe("owner session", () => {
  it("is valid until it expires", () => {
    const token = createSession(NOW);
    expect(isValidSession(token, NOW)).toBe(true);
    expect(isValidSession(token, NOW + SESSION_TTL_MS - 1)).toBe(true);
    expect(isValidSession(token, NOW + SESSION_TTL_MS)).toBe(false);
  });

  it("rejects a forged token", () => {
    expect(isValidSession(`owner.${NOW + 1_000}.forged`, NOW)).toBe(false);
  });

  it("rejects a signed token that is not a session", () => {
    expect(isValidSession(sign("something-else"), NOW)).toBe(false);
  });

  it("rejects no token", () => {
    expect(isValidSession(undefined, NOW)).toBe(false);
  });
});

describe("checkPassword", () => {
  it("accepts the configured password only", () => {
    expect(checkPassword("test-owner-password")).toBe(true);
    expect(checkPassword("test-owner-passwore")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
});
