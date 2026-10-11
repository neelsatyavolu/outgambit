import type { Tokens } from "@neelsatyavolu/shared-ai-auth";
import { errorName } from "../ai/result";
import { BUDGET } from "../config";

/** One of a subscription's usage windows, as the provider reports it. */
export type Window = { usedPercent: number; resetsAt: number; lengthMs: number };

/** A subscription's own count of what has been used: the long window, and the short one if it has one. */
export type Meter = { weekly: Window; short: Window | null };

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const READ_TIMEOUT_MS = 8_000;
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/**
 * The percent of the weekly allowance that may have been used by `now`: a
 * straight line from nothing when the week starts to the allowed share when
 * it resets. Staying under it spreads that share over the whole week.
 */
export function paceLine(week: Window, now: number): number {
  const elapsed = clamp((now - (week.resetsAt - week.lengthMs)) / week.lengthMs, 0, 1);
  return BUDGET.weeklyShare * 100 * elapsed;
}

/**
 * How far under the pace line the meter is, in percent of the weekly
 * allowance, and what stops play if anything does.
 */
export function headroom(meter: Meter, now: number): { points: number; closed: "pace" | "short_window" | null } {
  const points = Math.max(0, paceLine(meter.weekly, now) - meter.weekly.usedPercent);
  if (meter.short && meter.short.usedPercent >= BUDGET.shortWindowShare * 100) return { points, closed: "short_window" };
  return { points, closed: points > 0 ? null : "pace" };
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

type CodexWindow = { used_percent?: unknown; limit_window_seconds?: unknown; reset_at?: unknown };

function codexWindow(raw: CodexWindow | null | undefined): Window | null {
  if (!raw || !isNumber(raw.used_percent) || !isNumber(raw.limit_window_seconds) || !isNumber(raw.reset_at)) return null;
  if (raw.limit_window_seconds <= 0) return null;
  return { usedPercent: raw.used_percent, lengthMs: raw.limit_window_seconds * 1000, resetsAt: raw.reset_at * 1000 };
}

/**
 * Reads ChatGPT's usage report. The weekly window is whichever one runs for
 * about a week: it is not always the second of the two. Null if there is none.
 */
export function parseCodexUsage(body: unknown): Meter | null {
  const limit = (body as { rate_limit?: { primary_window?: CodexWindow; secondary_window?: CodexWindow } } | null)?.rate_limit;
  const windows = [codexWindow(limit?.primary_window), codexWindow(limit?.secondary_window)].filter((w) => w !== null);
  const weekly = windows.find((w) => w.lengthMs >= SIX_DAYS_MS);
  if (!weekly) return null;
  return { weekly, short: windows.find((w) => w.lengthMs < SIX_DAYS_MS) ?? null };
}

type GrokBilling = { config?: { creditUsagePercent?: unknown; currentPeriod?: { start?: unknown; end?: unknown } } };

/** Reads Grok's billing report: one usage period, with the percent of it used. Null if it does not say. */
export function parseGrokBilling(body: unknown): Meter | null {
  const config = (body as GrokBilling | null)?.config;
  const period = config?.currentPeriod;
  if (!isNumber(config?.creditUsagePercent) || typeof period?.start !== "string" || typeof period.end !== "string") return null;
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (!(end > start)) return null;
  return { weekly: { usedPercent: config.creditUsagePercent, resetsAt: end, lengthMs: end - start }, short: null };
}

/** Fetches a report and reads it. A string is a few fixed words saying what went wrong. */
async function read(
  url: string,
  headers: Record<string, string>,
  parse: (body: unknown) => Meter | null,
  fetcher: typeof fetch,
): Promise<Meter | string> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!response.ok) return `HTTP ${response.status}`;
    return parse(await response.json()) ?? "bad response";
  } catch (error) {
    return errorName(error);
  }
}

/** ChatGPT's meter for the signed-in subscription, from the endpoint the Codex CLI reads. */
export function readCodexMeter(tokens: Tokens, fetcher: typeof fetch = fetch): Promise<Meter | string> {
  const headers = {
    Authorization: `Bearer ${tokens.accessToken}`,
    originator: "codex_cli_rs",
    ...(tokens.accountId ? { "chatgpt-account-id": tokens.accountId } : {}),
  };
  return read(CODEX_USAGE_URL, headers, parseCodexUsage, fetcher);
}

/** Grok's meter for the signed-in subscription, from the endpoint the Grok CLI reads. */
export function readGrokMeter(tokens: Tokens, fetcher: typeof fetch = fetch): Promise<Meter | string> {
  const headers = {
    Authorization: `Bearer ${tokens.accessToken}`,
    "x-grok-client-mode": "cli",
    "x-grok-client-version": "1.0.4",
  };
  return read(GROK_BILLING_URL, headers, parseGrokBilling, fetcher);
}
