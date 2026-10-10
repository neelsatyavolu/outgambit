import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clientIp, fail, hashIp, isPlayerId, ok, readBody, sameOrigin } from "./http";

const post = (headers: Record<string, string>) => new Request("https://gambit.test/api/games", { method: "POST", headers });

describe("envelope", () => {
  it("wraps data", async () => {
    const response = ok({ id: "g" }, 201);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, data: { id: "g" } });
  });

  it("wraps an error", async () => {
    const response = fail("Nope.", 409);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: "Nope." });
  });

  it("is never cached", () => {
    expect(ok({}).headers.get("cache-control")).toBe("no-store");
  });
});

describe("sameOrigin", () => {
  it("accepts a request from the site itself", () => {
    expect(sameOrigin(post({ origin: "https://gambit.test", host: "gambit.test" }))).toBe(true);
  });

  it("uses the forwarded host behind a proxy", () => {
    expect(sameOrigin(post({ origin: "https://gambit.test", host: "internal:3000", "x-forwarded-host": "gambit.test" }))).toBe(true);
  });

  it("rejects another site, a missing origin and a malformed one", () => {
    expect(sameOrigin(post({ origin: "https://evil.test", host: "gambit.test" }))).toBe(false);
    expect(sameOrigin(post({ host: "gambit.test" }))).toBe(false);
    expect(sameOrigin(post({ origin: "null", host: "gambit.test" }))).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp(post({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a fixed value", () => {
    expect(clientIp(post({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(post({}))).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("is stable and does not contain the address", () => {
    expect(hashIp("203.0.113.7")).toBe(hashIp("203.0.113.7"));
    expect(hashIp("203.0.113.7")).not.toContain("203");
    expect(hashIp("203.0.113.7")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs between addresses", () => {
    expect(hashIp("203.0.113.7")).not.toBe(hashIp("203.0.113.8"));
  });
});

describe("isPlayerId", () => {
  it("accepts only UUIDs", () => {
    expect(isPlayerId("3f2c1a9e-8b7d-4c6f-9a1b-2c3d4e5f6a7b")).toBe(true);
    expect(isPlayerId("player-1")).toBe(false);
    expect(isPlayerId(undefined)).toBe(false);
  });
});

describe("readBody", () => {
  const schema = z.object({ ply: z.number().int() });
  const withBody = (body: string, type = "application/json") =>
    new Request("https://gambit.test/x", { method: "POST", body, headers: { "content-type": type } });

  it("returns the validated body", async () => {
    expect(await readBody(withBody('{"ply":3,"extra":true}'), schema)).toEqual({ ply: 3 });
    expect(await readBody(withBody('{"ply":3}', "application/json; charset=utf-8"), schema)).toEqual({ ply: 3 });
  });

  it("returns null for a body that fails validation", async () => {
    expect(await readBody(withBody('{"ply":"3"}'), schema)).toBeNull();
  });

  it("returns null for a body that is not JSON, or is missing", async () => {
    expect(await readBody(withBody("ply=3"), schema)).toBeNull();
    expect(await readBody(new Request("https://gambit.test/x", { method: "POST" }), schema)).toBeNull();
  });

  it("refuses JSON that was not sent as JSON, which a cross-site form could do", async () => {
    expect(await readBody(withBody('{"ply":3}', "text/plain"), schema)).toBeNull();
  });
});
