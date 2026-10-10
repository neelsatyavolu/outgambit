import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { getConnection } from "../db/connections";
import { readSecret } from "./credentials";
import { decrypt, encrypt } from "./crypto";
import { finishOAuth, startOAuth, type Exchange } from "./oauth";

const NOW = 1_800_000_000_000;
const TOKENS = { accessToken: "at", refreshToken: "rt", expiresAt: NOW + 3_600_000, accountId: "acct" };

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const pendingOf = (pending: string) => JSON.parse(decrypt(pending)) as { state: string; verifier: string };
const okExchange: Exchange = async () => TOKENS;

describe("startOAuth", () => {
  it("returns the provider's sign-in URL carrying the pending state", () => {
    const { url, pending } = startOAuth("codex", NOW);
    expect(url).toContain("https://auth.openai.com/oauth/authorize");
    expect(new URL(url).searchParams.get("state")).toBe(pendingOf(pending).state);
  });

  it("does not expose the verifier in the URL", () => {
    const { url, pending } = startOAuth("grok", NOW);
    expect(url).not.toContain(pendingOf(pending).verifier);
  });
});

describe("finishOAuth", () => {
  it("stores encrypted tokens after a valid callback", async () => {
    const { pending } = startOAuth("codex", NOW);
    const callback = `http://localhost:1455/auth/callback?code=abc&state=${pendingOf(pending).state}`;
    const calls: unknown[] = [];
    const exchange: Exchange = async (...args) => {
      calls.push(args);
      return TOKENS;
    };
    expect(await finishOAuth(db, "codex", callback, pending, NOW, exchange)).toEqual({ ok: true });
    expect(calls).toEqual([["codex", "abc", pendingOf(pending).verifier]]);
    const stored = await getConnection(db, "codex");
    expect(stored?.secret).not.toContain("rt");
    expect(readSecret(stored!.secret)).toEqual({ kind: "oauth", tokens: TOKENS });
  });

  it("accepts Grok's bare code", async () => {
    const { pending } = startOAuth("grok", NOW);
    expect(await finishOAuth(db, "grok", "  bare-code-123  ", pending, NOW, okExchange)).toEqual({ ok: true });
  });

  it("rejects a callback with the wrong state and stores nothing", async () => {
    const { pending } = startOAuth("codex", NOW);
    const result = await finishOAuth(db, "codex", "http://localhost:1455/auth/callback?code=abc&state=evil", pending, NOW, okExchange);
    expect(result).toEqual({ ok: false, error: "That callback belongs to a different sign-in attempt. Start again." });
    expect(await getConnection(db, "codex")).toBeNull();
  });

  it("rejects a bare code for ChatGPT, which always returns a state", async () => {
    const { pending } = startOAuth("codex", NOW);
    expect((await finishOAuth(db, "codex", "abc", pending, NOW, okExchange)).ok).toBe(false);
  });

  it("rejects garbage", async () => {
    const { pending } = startOAuth("grok", NOW);
    for (const pasted of ["", "   ", "not a code at all", "http://[bad"]) {
      const result = await finishOAuth(db, "grok", pasted, pending, NOW, okExchange);
      expect(result).toEqual({ ok: false, error: "That does not look like a callback URL or code." });
    }
    expect(await getConnection(db, "grok")).toBeNull();
  });

  it("reports an error the provider put in the callback", async () => {
    const { pending } = startOAuth("codex", NOW);
    const result = await finishOAuth(db, "codex", "http://localhost:1455/auth/callback?error=access_denied", pending, NOW, okExchange);
    expect(result).toEqual({ ok: false, error: "The provider refused the sign-in. Start again." });
  });

  it("rejects an attempt that has expired", async () => {
    const { pending } = startOAuth("grok", NOW);
    const result = await finishOAuth(db, "grok", "code", pending, NOW + 11 * 60_000, okExchange);
    expect(result).toEqual({ ok: false, error: "That sign-in attempt expired. Start again." });
  });

  it("rejects a missing or forged pending attempt", async () => {
    for (const pending of [undefined, "junk", encrypt("{}")]) {
      const result = await finishOAuth(db, "grok", "code", pending, NOW, okExchange);
      expect(result).toEqual({ ok: false, error: "That sign-in attempt expired. Start again." });
    }
  });

  it("rejects an attempt started for the other provider", async () => {
    const { pending } = startOAuth("codex", NOW);
    expect((await finishOAuth(db, "grok", "code", pending, NOW, okExchange)).ok).toBe(false);
  });

  it("reports a failed token exchange without storing anything", async () => {
    const { pending } = startOAuth("grok", NOW);
    const failing: Exchange = async () => {
      throw new Error("grok token request failed (400)");
    };
    const result = await finishOAuth(db, "grok", "code", pending, NOW, failing);
    expect(result).toEqual({ ok: false, error: "The provider rejected that code. Start again." });
    expect(await getConnection(db, "grok")).toBeNull();
  });
});
