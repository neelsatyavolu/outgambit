import type { Adapter, MoveRequest, MoveResult } from "@/lib/ai/types";
import type { Db } from "@/lib/db/client";
import type { CreateInput } from "@/lib/game/create";
import type { Deps } from "@/lib/game/deps";
import type { OfferedModel } from "@/lib/owner/catalog";
import { NOON } from "./factory";

export const FAST: OfferedModel = {
  provider: "fake", id: "fake-1", label: "Scripted", supportsEffort: false,
  timeControls: ["1+0", "2+1", "3+0", "5+0", "10+10", "20+20", "45+30"],
};
export const SLOW: OfferedModel = {
  provider: "codex", id: "gpt-a", label: "GPT A", supportsEffort: true, timeControls: ["10+10", "20+20", "45+30"],
};

export const PAID: OfferedModel = {
  provider: "jev", id: "jev-latest", label: "Jev", supportsEffort: false, timeControls: ["1+0"],
};

/** A subscription week that began three and a half days before NOON, with `usedPercent` of it used. */
export const meterAt = (usedPercent: number, short: number | null = null) => {
  const week = 7 * 24 * 60 * 60 * 1000;
  return {
    weekly: { usedPercent, resetsAt: NOON + week / 2, lengthMs: week },
    short: short === null ? null : { usedPercent: short, resetsAt: NOON + 60_000, lengthMs: 5 * 60 * 60 * 1000 },
  };
};

export type Harness = {
  deps: Deps;
  clock: { now: number };
  /** Every request the AI adapter received. */
  requests: MoveRequest[];
  /** Jobs handed to `schedule` and not yet run. */
  jobs: Array<() => Promise<void>>;
  runJobs: () => Promise<void>;
};

/** Replies for the AI, in order. A string is a SAN move; the last entry repeats. */
export type Reply =
  | string
  | MoveResult
  | ((request: MoveRequest, clock: { now: number }) => MoveResult | Promise<MoveResult>);

export function harness(db: Db, replies: Reply[] = [], overrides: Partial<Deps> = {}): Harness {
  const clock = { now: NOON };
  const requests: MoveRequest[] = [];
  const jobs: Array<() => Promise<void>> = [];
  const adapter: Adapter = async (request) => {
    const reply = replies[Math.min(requests.length, replies.length - 1)];
    requests.push(request);
    if (reply === undefined) return { kind: "move", san: request.legalMoves[0].san };
    if (typeof reply === "string") return { kind: "move", san: reply };
    return typeof reply === "function" ? reply(request, clock) : reply;
  };
  const deps: Deps = {
    db,
    now: () => clock.now,
    adapterFor: async () => adapter,
    schedule: (job) => void jobs.push(job),
    findModel: async (provider, id) => [FAST, SLOW, PAID].find((m) => m.provider === provider && m.id === id) ?? null,
    // Subscriptions with nothing used yet, and the larger OpenRouter limit, unless a test says otherwise.
    usage: {
      meter: async () => ({ value: meterAt(0), readAt: clock.now, error: null }),
      openRouterCap: async () => 1000,
    },
    random: () => 0,
    ...overrides,
  };
  const runJobs = async () => {
    while (jobs.length > 0) await jobs.shift()!();
  };
  return { deps, clock, requests, jobs, runJobs };
}

export const input = (overrides: Partial<CreateInput> = {}): CreateInput => ({
  playerId: "player-1", ipHash: "ip-1", provider: "fake", model: "fake-1", effort: null,
  timeControl: "10+10", color: "white", ...overrides,
});
