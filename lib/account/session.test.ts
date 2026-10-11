import { describe, expect, it } from "vitest";
import { sign } from "../owner/crypto";
import { createSession, isValidSession } from "../owner/session";
import { isPlayerId } from "../http";
import { ACCOUNT_TTL_MS, accountPlayerId, accountSessionOf, createAccountSession } from "./session";

const NOW = 1_800_000_000_000;
const USER = "3f0c2f6e-5b1a-4c8e-9d2a-7e6f5a4b3c2d";

describe("account session", () => {
  it("names its user and the session version it was made at, until it expires", () => {
    const token = createAccountSession(USER, NOW, 3);
    expect(accountSessionOf(token, NOW)).toEqual({ userId: USER, version: 3 });
    expect(accountSessionOf(token, NOW + ACCOUNT_TTL_MS - 1)).toEqual({ userId: USER, version: 3 });
    expect(accountSessionOf(token, NOW + ACCOUNT_TTL_MS)).toBeNull();
  });

  it("reads a session made before versions were written into it as one of version 0", () => {
    const legacy = sign(`account.${USER}.${NOW + 1_000}`);
    expect(accountSessionOf(legacy, NOW)).toEqual({ userId: USER, version: 0 });
    expect(accountSessionOf(legacy, NOW + 1_000)).toBeNull();
  });

  it.each(["-1", "one", "1e400", " "])("rejects a signed token whose version is %j", (version) => {
    expect(accountSessionOf(sign(`account.${USER}.${NOW + 1_000}.${version}`), NOW)).toBeNull();
  });

  it("rejects a forged token", () => {
    expect(accountSessionOf(`account.${USER}.${NOW + 1_000}.forged`, NOW)).toBeNull();
  });

  it("rejects a signed token that does not name a user", () => {
    expect(accountSessionOf(sign(`account.not-a-user.${NOW + 1_000}`), NOW)).toBeNull();
    expect(accountSessionOf(sign("something-else"), NOW)).toBeNull();
  });

  it("is not interchangeable with the owner's session", () => {
    expect(accountSessionOf(createSession(NOW), NOW)).toBeNull();
    expect(isValidSession(createAccountSession(USER, NOW, 0), NOW)).toBe(false);
  });

  it("rejects no token", () => {
    expect(accountSessionOf(undefined, NOW)).toBeNull();
  });
});

describe("accountPlayerId", () => {
  it("is distinct per user and can never be read from the anonymous-id cookie", () => {
    expect(accountPlayerId(USER)).not.toBe(USER);
    expect(accountPlayerId(USER)).toContain(USER);
    expect(isPlayerId(accountPlayerId(USER))).toBe(false);
  });
});
