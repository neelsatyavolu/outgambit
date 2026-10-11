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
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*OWNER_PASSWORD[\s\S]*SECRETS_KEY[\s\S]*IP_SALT/);
  });

  it("rejects a SECRETS_KEY that is not 32 bytes", () => {
    expect(() => parseEnv({ ...valid, SECRETS_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/SECRETS_KEY/);
  });

  it("rejects a short owner password", () => {
    expect(() => parseEnv({ ...valid, OWNER_PASSWORD: "short" })).toThrow(/OWNER_PASSWORD/);
  });
});

describe("parseEnv, for the reset email", () => {
  const mail = { RESEND_API_KEY: "re_test_key", APP_URL: "https://outgambit.n3el.dev" };
  const production = { ...valid, NODE_ENV: "production" };

  it("needs neither setting outside production, and assumes the local address", () => {
    const env = parseEnv({ ...valid, NODE_ENV: "development" });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.APP_URL).toBe("http://localhost:3000");
  });

  it("refuses to start production without the key or the site's address", () => {
    expect(() => parseEnv(production)).toThrow(/RESEND_API_KEY[\s\S]*APP_URL/);
    expect(() => parseEnv({ ...production, APP_URL: mail.APP_URL })).toThrow(/RESEND_API_KEY/);
    expect(() => parseEnv({ ...production, RESEND_API_KEY: mail.RESEND_API_KEY })).toThrow(/APP_URL/);
    expect(() => parseEnv({ ...production, ...mail, RESEND_API_KEY: "" })).toThrow(/RESEND_API_KEY/);
  });

  it("accepts a complete production environment", () => {
    expect(parseEnv({ ...production, ...mail })).toMatchObject(mail);
  });

  it("keeps only the origin of APP_URL, so a link can never be built on a stray path", () => {
    expect(parseEnv({ ...valid, APP_URL: "https://outgambit.n3el.dev/" }).APP_URL).toBe("https://outgambit.n3el.dev");
    expect(parseEnv({ ...valid, APP_URL: "http://localhost:3210/account?x=1" }).APP_URL).toBe("http://localhost:3210");
  });

  it.each(["outgambit.n3el.dev", "not a url", "javascript:alert(1)", "ftp://outgambit.n3el.dev"])(
    "rejects %s as APP_URL",
    (value) => {
      expect(() => parseEnv({ ...production, ...mail, APP_URL: value })).toThrow(/APP_URL/);
      expect(() => parseEnv({ ...valid, APP_URL: value })).toThrow(/APP_URL/);
    },
  );
});
