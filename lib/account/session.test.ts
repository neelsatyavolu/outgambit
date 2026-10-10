import { describe, expect, it } from "vitest";
import { sign } from "../owner/crypto";
import { createSession, isValidSession } from "../owner/session";
import { isPlayerId } from "../http";
import { ACCOUNT_TTL_MS, accountOf, accountPlayerId, createAccountSession } from "./session";

const NOW = 1_800_000_000_000;
const USER = "3f0c2f6e-5b1a-4c8e-9d2a-7e6f5a4b3c2d";

describe("account session", () => {
  it("names its user until it expires", () => {
    const token = createAccountSession(USER, NOW);
    expect(accountOf(token, NOW)).toBe(USER);
    expect(accountOf(token, NOW + ACCOUNT_TTL_MS - 1)).toBe(USER);
    expect(accountOf(token, NOW + ACCOUNT_TTL_MS)).toBeNull();
  });

  it("rejects a forged token", () => {
    expect(accountOf(`account.${USER}.${NOW + 1_000}.forged`, NOW)).toBeNull();
  });

  it("rejects a signed token that does not name a user", () => {
    expect(accountOf(sign(`account.not-a-user.${NOW + 1_000}`), NOW)).toBeNull();
    expect(accountOf(sign("something-else"), NOW)).toBeNull();
  });

  it("is not interchangeable with the owner's session", () => {
    expect(accountOf(createSession(NOW), NOW)).toBeNull();
    expect(isValidSession(createAccountSession(USER, NOW), NOW)).toBe(false);
  });

  it("rejects no token", () => {
    expect(accountOf(undefined, NOW)).toBeNull();
  });
});

describe("accountPlayerId", () => {
  it("is distinct per user and can never be read from the anonymous-id cookie", () => {
    expect(accountPlayerId(USER)).not.toBe(USER);
    expect(accountPlayerId(USER)).toContain(USER);
    expect(isPlayerId(accountPlayerId(USER))).toBe(false);
  });
});
