import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "pglite://memory",
  OWNER_PASSWORD: "correct horse battery",
  SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
  IP_SALT: "0123456789abcdef",
};

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(valid).DATABASE_URL).toBe("pglite://memory");
  });

  it("names every missing variable", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL.*OWNER_PASSWORD.*SECRETS_KEY.*IP_SALT/s);
  });

  it("rejects a SECRETS_KEY that is not 32 bytes", () => {
    expect(() => parseEnv({ ...valid, SECRETS_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/SECRETS_KEY/);
  });

  it("rejects a short owner password", () => {
    expect(() => parseEnv({ ...valid, OWNER_PASSWORD: "short" })).toThrow(/OWNER_PASSWORD/);
  });
});
