import { describe, expect, it } from "vitest";
import { headroom, paceLine, parseCodexUsage, parseGrokBilling, readCodexMeter, readGrokMeter, type Window } from "./meter";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const START = Date.UTC(2026, 9, 5);
const week = (usedPercent: number): Window => ({ usedPercent, resetsAt: START + WEEK, lengthMs: WEEK });
const tokens = { accessToken: "access", refreshToken: "refresh", expiresAt: 0, accountId: "acct" };
const replying = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("paceLine", () => {
  it("starts the week with the leeway and nothing more", () => {
    expect(paceLine(week(0), START)).toBe(10);
  });

  it("allows a quarter of the allowance and the leeway half way through the week", () => {
    expect(paceLine(week(0), START + WEEK / 2)).toBe(35);
  });

  it("never passes half the allowance, leeway or not", () => {
    expect(paceLine(week(0), START + WEEK - DAY / 2)).toBe(50);
  });

  it("ends the week at half the allowance, and stays there if the reading is late", () => {
    expect(paceLine(week(0), START + WEEK)).toBe(50);
    expect(paceLine(week(0), START + WEEK + DAY)).toBe(50);
  });
});

describe("headroom", () => {
  const midweek = START + WEEK / 2;

  it("is the gap between the meter and the pace line", () => {
    expect(headroom({ weekly: week(10), short: null }, midweek)).toEqual({ points: 25, closed: null });
  });

  it("closes on pace once the meter has caught the line", () => {
    expect(headroom({ weekly: week(35), short: null }, midweek)).toEqual({ points: 0, closed: "pace" });
    expect(headroom({ weekly: week(80), short: null }, midweek)).toEqual({ points: 0, closed: "pace" });
  });

  it("closes when half the short window is used, even under the weekly pace", () => {
    const short = { usedPercent: 50, resetsAt: midweek + 1, lengthMs: 5 * 60 * 60 * 1000 };
    expect(headroom({ weekly: week(10), short }, midweek)).toEqual({ points: 25, closed: "short_window" });
    expect(headroom({ weekly: week(10), short: { ...short, usedPercent: 49 } }, midweek).closed).toBeNull();
  });
});

describe("parseCodexUsage", () => {
  const fiveHours = { used_percent: 12, limit_window_seconds: 18_000, reset_after_seconds: 60, reset_at: 1_790_000_000 };
  const sevenDays = { used_percent: 27, limit_window_seconds: 604_800, reset_after_seconds: 60, reset_at: 1_790_500_000 };

  it("reads the weekly and five-hour windows", () => {
    const body = { plan_type: "pro", rate_limit: { allowed: true, primary_window: fiveHours, secondary_window: sevenDays } };
    expect(parseCodexUsage(body)).toEqual({
      weekly: { usedPercent: 27, lengthMs: WEEK, resetsAt: 1_790_500_000_000 },
      short: { usedPercent: 12, lengthMs: 18_000_000, resetsAt: 1_790_000_000_000 },
    });
  });

  it("finds the weekly window when it is the only one, listed first", () => {
    const body = { rate_limit: { primary_window: sevenDays, secondary_window: null } };
    expect(parseCodexUsage(body)).toEqual({ weekly: { usedPercent: 27, lengthMs: WEEK, resetsAt: 1_790_500_000_000 }, short: null });
  });

  it("is null without a weekly window", () => {
    expect(parseCodexUsage({ rate_limit: { primary_window: fiveHours } })).toBeNull();
    expect(parseCodexUsage({ rate_limit: null })).toBeNull();
    expect(parseCodexUsage("nope")).toBeNull();
  });
});

describe("parseGrokBilling", () => {
  const period = { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-08-17T17:33:48.278812+00:00", end: "2026-08-24T17:33:48.278812+00:00" };

  it("reads the percent used and the period it covers", () => {
    expect(parseGrokBilling({ config: { currentPeriod: period, creditUsagePercent: 1.5 } })).toEqual({
      weekly: { usedPercent: 1.5, resetsAt: Date.parse(period.end), lengthMs: WEEK },
      short: null,
    });
  });

  it("is null when the percent or the period is missing", () => {
    expect(parseGrokBilling({ config: { currentPeriod: period } })).toBeNull();
    expect(parseGrokBilling({ config: { creditUsagePercent: 1 } })).toBeNull();
    expect(parseGrokBilling({ config: { creditUsagePercent: 1, currentPeriod: { ...period, end: period.start } } })).toBeNull();
    expect(parseGrokBilling({})).toBeNull();
  });
});

describe("reading a meter", () => {
  it("asks ChatGPT as the signed-in account", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 604_800, reset_at: 1_790_500_000 } } }));
    }) as typeof fetch;
    expect(await readCodexMeter(tokens, fetcher)).toMatchObject({ weekly: { usedPercent: 3 } });
    expect(calls[0][0]).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(calls[0][1].headers).toMatchObject({ Authorization: "Bearer access", "chatgpt-account-id": "acct" });
  });

  it("asks Grok as its command-line client", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ config: { creditUsagePercent: 4, currentPeriod: { start: "2026-08-17T00:00:00Z", end: "2026-08-24T00:00:00Z" } } }));
    }) as typeof fetch;
    expect(await readGrokMeter(tokens, fetcher)).toMatchObject({ weekly: { usedPercent: 4 } });
    expect(calls[0][0]).toBe("https://cli-chat-proxy.grok.com/v1/billing?format=credits");
    expect(calls[0][1].headers).toMatchObject({ Authorization: "Bearer access", "x-grok-client-mode": "cli" });
  });

  it("says what went wrong in a few fixed words", async () => {
    expect(await readCodexMeter(tokens, replying(401, {}) as typeof fetch)).toBe("HTTP 401");
    expect(await readCodexMeter(tokens, replying(200, { rate_limit: null }) as typeof fetch)).toBe("bad response");
    const failing = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    expect(await readGrokMeter(tokens, failing)).toBe("TypeError");
  });
});
