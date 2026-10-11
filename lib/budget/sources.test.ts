import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import type { Db } from "../db/client";
import { saveSecret } from "../owner/credentials";
import { usageSource } from "./sources";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const NOW = 1_800_000_000_000;
const tokens = { accessToken: "at-1", refreshToken: "rt-1", expiresAt: NOW + 3_600_000, accountId: "acct" };

/** A fetch that answers every URL containing a key of `replies` with its value, and notes what was asked. */
function fetching(replies: Record<string, unknown>) {
  const asked: Array<{ url: string; authorization: string }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    asked.push({ url, authorization: (init.headers as Record<string, string>).Authorization });
    const match = Object.keys(replies).find((part) => url.includes(part));
    return match ? new Response(JSON.stringify(replies[match])) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { asked, fetcher };
}

const week = { used_percent: 31, limit_window_seconds: 604_800, reset_at: (NOW + 86_400_000) / 1000 };

describe("a subscription's meter", () => {
  it("is read with the owner's stored sign-in, and not again for five minutes", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens }, NOW);
    const { asked, fetcher } = fetching({ "chatgpt.com": { rate_limit: { primary_window: week } } });
    const usage = usageSource(db, fetcher);
    expect(await usage.meter("codex", NOW)).toMatchObject({ value: { weekly: { usedPercent: 31 }, short: null }, readAt: NOW, error: null });
    await usage.meter("codex", NOW + 60_000);
    expect(asked).toEqual([{ url: "https://chatgpt.com/backend-api/wham/usage", authorization: "Bearer at-1" }]);
  });

  it("reads Grok's from its billing report", async () => {
    await saveSecret(db, "grok", { kind: "oauth", tokens }, NOW);
    const period = { start: new Date(NOW - 86_400_000).toISOString(), end: new Date(NOW + 6 * 86_400_000).toISOString() };
    const { asked, fetcher } = fetching({ "grok.com": { config: { creditUsagePercent: 7, currentPeriod: period } } });
    expect((await usageSource(db, fetcher).meter("grok", NOW)).value).toMatchObject({ weekly: { usedPercent: 7, lengthMs: 7 * 86_400_000 } });
    expect(asked[0].url).toContain("cli-chat-proxy.grok.com/v1/billing");
  });

  it("has no reading for a provider that is not connected, and asks nobody", async () => {
    const { asked, fetcher } = fetching({});
    expect(await usageSource(db, fetcher).meter("codex", NOW)).toEqual({ value: null, readAt: null, error: "not connected" });
    expect(asked).toEqual([]);
  });

  it("renews a sign-in the provider rejects, once, and reads with the new one", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens }, NOW);
    const asked: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>).Authorization;
      asked.push(authorization);
      return authorization === "Bearer at-2"
        ? new Response(JSON.stringify({ rate_limit: { primary_window: week } }))
        : new Response("{}", { status: 401 });
    }) as typeof fetch;
    const renewals: string[] = [];
    const refresh = async (_provider: string, refreshToken: string) => {
      renewals.push(refreshToken);
      return { ...tokens, accessToken: "at-2", refreshToken: "rt-2" };
    };
    expect(await usageSource(db, fetcher, refresh).meter("codex", NOW)).toMatchObject({ value: { weekly: { usedPercent: 31 } }, error: null });
    expect(asked).toEqual(["Bearer at-1", "Bearer at-2"]);
    expect(renewals).toEqual(["rt-1"]);
  });

  it("gives up on a sign-in that is still rejected after renewing it", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens }, NOW);
    const fetcher = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const refresh = async () => ({ ...tokens, accessToken: "at-2" });
    expect(await usageSource(db, fetcher, refresh).meter("codex", NOW)).toMatchObject({ value: null, error: "HTTP 401" });
  });

  it("says so when the provider refuses", async () => {
    await saveSecret(db, "codex", { kind: "oauth", tokens }, NOW);
    expect(await usageSource(db, fetching({}).fetcher).meter("codex", NOW)).toEqual({ value: null, readAt: null, error: "HTTP 404" });
  });
});

describe("OpenRouter's free limit", () => {
  const connect = () => saveSecret(db, "openrouter", { kind: "key", apiKey: "or-key" }, NOW);

  it("is the larger one for an account that has bought credits", async () => {
    await connect();
    const { asked, fetcher } = fetching({ "openrouter.ai": { data: { is_free_tier: false } } });
    expect(await usageSource(db, fetcher).openRouterCap(NOW)).toBe(1000);
    expect(asked).toEqual([{ url: "https://openrouter.ai/api/v1/key", authorization: "Bearer or-key" }]);
  });

  it("is the smaller one for an account that has not", async () => {
    await connect();
    expect(await usageSource(db, fetching({ "openrouter.ai": { data: { is_free_tier: true } } }).fetcher).openRouterCap(NOW)).toBe(50);
  });

  it("is taken to be the smaller one when it cannot be read", async () => {
    expect(await usageSource(db, fetching({}).fetcher).openRouterCap(NOW)).toBe(50);
    await connect();
    expect(await usageSource(db, fetching({ "openrouter.ai": { data: {} } }).fetcher).openRouterCap(NOW + 120_000)).toBe(50);
  });
});
