import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("accepts the password it was made from, and no other", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterz", stored)).toBe(false);
  });

  it("never stores the password itself", async () => {
    expect(await hashPassword("correct horse battery")).not.toContain("correct horse battery");
  });

  it("salts each hash, so one password is stored differently every time", async () => {
    expect(await hashPassword("correct horse battery")).not.toBe(await hashPassword("correct horse battery"));
  });

  it("rejects a stored value it does not recognise", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$x$8$1$c2FsdA$aGFzaA")).toBe(false);
  });

  it("rejects a stored hash whose key is missing or cut short", async () => {
    expect(await verifyPassword("anything", "scrypt$32768$8$3$c2FsdA$!")).toBe(false);
    const [scheme, n, r, p, salt, key] = (await hashPassword("anything")).split("$");
    expect(await verifyPassword("anything", [scheme, n, r, p, salt, key.slice(0, 8)].join("$"))).toBe(false);
  });
});
