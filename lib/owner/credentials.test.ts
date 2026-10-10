import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pausingAfter, resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { getConnection } from "../db/connections";
import { getCredentials, readSecret, saveSecret, type Refresh } from "./credentials";

const NOW = 1_800_000_000_000;
const fresh = { accessToken: "at-1", refreshToken: "rt-1", expiresAt: NOW + 3_600_000 };
const stale = { ...fresh, expiresAt: NOW + 10_000, accountId: "acct" };

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const neverRefresh: Refresh = async () => {
  throw new Error("refresh should not be called");
};

describe("getCredentials", () => {
  it("returns null when the provider is not connected", async () => {
    expect(await getCredentials(db, "gemini", NOW, neverRefresh)).toBeNull();
  });

  it("returns a stored API key", async () => {
    await saveSecret(db, "gemini", { kind: "key", apiKey: "g-key" }, NOW);
    expect(await getCredentials(db, "gemini", NOW, neverRefresh)).toEqual({ kind: "key", apiKey: "g-key" });
  });

  it("returns OAuth tokens that are still good without refreshing", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens: fresh }, NOW);
    expect(await getCredentials(db, "codex", NOW, neverRefresh)).toEqual({ kind: "oauth", tokens: fresh });
  });

  it("refreshes tokens that are about to expire and stores the rotated ones", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens: stale }, NOW);
    const rotated = { accessToken: "at-2", refreshToken: "rt-2", expiresAt: NOW + 3_600_000, accountId: "acct" };
    const calls: unknown[] = [];
    const refresh: Refresh = async (provider, token, options) => {
      calls.push([provider, token, options]);
      return rotated;
    };
    expect(await getCredentials(db, "codex", NOW, refresh)).toEqual({ kind: "oauth", tokens: rotated });
    expect(calls).toEqual([["codex", "rt-1", { previous: stale }]]);
    expect(readSecret((await getConnection(db, "codex"))!.secret)).toEqual({ kind: "oauth", tokens: rotated });
  });

  it("refreshes on demand even when the tokens have not expired", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens: fresh }, NOW);
    const rotated = { accessToken: "at-9", refreshToken: "rt-9", expiresAt: NOW + 3_600_000 };
    const refresh: Refresh = async () => rotated;
    expect(await getCredentials(db, "codex", NOW, refresh, { force: true })).toEqual({ kind: "oauth", tokens: rotated });
  });

  it("does not try to refresh an API key on demand", async () => {
    await saveSecret(db, "gemini", { kind: "key", apiKey: "g-key" }, NOW);
    expect(await getCredentials(db, "gemini", NOW, neverRefresh, { force: true })).toEqual({ kind: "key", apiKey: "g-key" });
  });

  it("refreshes once when two games ask at the same moment", async () => {
    await saveSecret(db, "grok", { kind: "oauth", tokens: stale }, NOW);
    let refreshes = 0;
    const refresh: Refresh = async () => {
      refreshes += 1;
      return { accessToken: `at-${refreshes + 1}`, refreshToken: "rt-2", expiresAt: NOW + 3_600_000 };
    };
    // Each caller lingers after reading the stored tokens inside its transaction.
    const racing = pausingAfter(db, /FROM connections/);
    const [a, b] = await Promise.all([
      getCredentials(racing, "grok", NOW, refresh),
      getCredentials(racing, "grok", NOW, refresh),
    ]);
    expect(refreshes).toBe(1);
    expect(a).toEqual(b);
  });

  it("keeps the old tokens when the refresh fails", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens: stale }, NOW);
    const failing: Refresh = async () => {
      throw new Error("codex token request failed (500)");
    };
    await expect(getCredentials(db, "codex", NOW, failing)).rejects.toThrow();
    expect(readSecret((await getConnection(db, "codex"))!.secret)).toEqual({ kind: "oauth", tokens: stale });
  });
});
