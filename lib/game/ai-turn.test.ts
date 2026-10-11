import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { NOON } from "@/test/factory";
import { harness, input, type Reply } from "@/test/game";
import type { Db } from "../db/client";
import { getGame, listMoves } from "../db/games";
import { gameCounts, usageSince } from "../db/usage";
import { callTimeoutMs, runAiTurn } from "./ai-turn";
import { createGame } from "./create";
import { dayKey } from "./limits";
import { playerMove } from "./move";
import { getGameView } from "./state";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const invalid = (raw: string) => ({ kind: "invalid", raw }) as const;
const failure = { kind: "provider_error", message: "HTTP 500" } as const;

/** A slow-provider game where the player has played 1. e4 and the AI's reply is still queued. */
async function afterE4(replies: Reply[], overrides = {}) {
  const h = harness(db, replies);
  const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low", ...overrides }));
  if (!created.ok) throw new Error(created.error);
  await playerMove(h.deps, created.game.id, "player-1", "e2e4", 0);
  return { h, id: created.game.id };
}

describe("runAiTurn", () => {
  it("asks the model with the position, effort and time left, then plays its move", async () => {
    const { h, id } = await afterE4(["e5"]);
    h.clock.now = NOON + 20_000;
    await h.runJobs();
    expect(h.requests[0]).toMatchObject({
      history: ["e4"], color: "black", model: "gpt-a", effort: "low", remainingMs: 580_000,
    });
    expect(h.requests[0].legalMoves).toHaveLength(20);
    expect(await getGame(db, id)).toMatchObject({ ply: 2, blackMs: 590_000, turnStartedAt: NOON + 20_000 });
  });

  it("retries with the rejected reply after an illegal move", async () => {
    const { h, id } = await afterE4([invalid("Qh4"), "e5"]);
    await h.runJobs();
    expect(h.requests.map((r) => r.rejected)).toEqual([undefined, "Qh4"]);
    expect((await listMoves(db, id)).map((m) => m.san)).toEqual(["e4", "e5"]);
  });

  it("forfeits the game after three illegal replies", async () => {
    const { h, id } = await afterE4([invalid("a"), invalid("b"), invalid("c"), "e5"]);
    await h.runJobs();
    expect(h.requests).toHaveLength(3);
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "white", reason: "illegal_move", ply: 1 });
  });

  it("retries once after a provider error", async () => {
    const { h, id } = await afterE4([failure, "e5"]);
    await h.runJobs();
    expect(await getGame(db, id)).toMatchObject({ ply: 2, status: "active" });
  });

  it("aborts the game after a second provider error and returns the slot", async () => {
    const { h, id } = await afterE4([failure, failure, "e5"]);
    await h.runJobs();
    expect(h.requests).toHaveLength(2);
    expect(await getGame(db, id)).toMatchObject({ status: "aborted", result: null, reason: "provider_error" });
    expect(await gameCounts(db, dayKey(NOON), "player-1", "ip-1")).toMatchObject([{ total: 0, player: 0 }]);
  });

  it("aborts when the provider is no longer connected", async () => {
    const h = harness(db, [], { adapterFor: async () => null });
    const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
    const id = created.ok ? created.game.id : "";
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    await h.runJobs();
    expect(await getGame(db, id)).toMatchObject({ status: "aborted", reason: "provider_error" });
  });

  it("aborts when loading the credentials throws", async () => {
    const h = harness(db, [], {
      adapterFor: async () => {
        throw new Error("codex token request failed (500)");
      },
    });
    const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
    const id = created.ok ? created.game.id : "";
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    await h.runJobs();
    expect(await getGame(db, id)).toMatchObject({ status: "aborted", reason: "provider_error" });
  });

  it("loses on time when the call outlasts the AI's clock", async () => {
    const slow: Reply = (_request, clock) => {
      clock.now += 601_000;
      return { kind: "provider_error", message: "TimeoutError" };
    };
    const { h, id } = await afterE4([slow]);
    await h.runJobs();
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "white", reason: "timeout", blackMs: 0 });
  });

  it("loses on time when a move arrives after the clock ran out", async () => {
    const late: Reply = (_request, clock) => {
      clock.now += 700_000;
      return { kind: "move", san: "e5" };
    };
    const { h, id } = await afterE4([late]);
    await h.runJobs();
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "white", reason: "timeout", ply: 1 });
  });

  it("caps one call at 240 seconds, or at the time left when that is less", () => {
    expect(callTimeoutMs(600_000, "codex")).toBe(240_000);
    expect(callTimeoutMs(45_000, "codex")).toBe(45_000);
  });

  it("caps a fast opponent's call at ten seconds", () => {
    expect(callTimeoutMs(600_000, "jev")).toBe(10_000);
    expect(callTimeoutMs(4_000, "jev")).toBe(4_000);
  });

  it("hands a turn over when another full call would not fit in one job, then aborts on the next failure", async () => {
    const hang: Reply = (_request, clock) => {
      clock.now += 240_000;
      return { kind: "provider_error", message: "TimeoutError" };
    };
    const { h, id } = await afterE4([hang]);
    await h.runJobs();
    // One call used most of the job; the game waits for a new runner instead of being cut off mid-call.
    expect(h.requests).toHaveLength(1);
    const waiting = await getGame(db, id);
    expect(waiting).toMatchObject({ status: "active", ply: 1 });
    expect(waiting!.aiLeaseUntil).toBeLessThanOrEqual(h.clock.now);

    await getGameView(h.deps, id, { owner: true });
    await h.runJobs();
    expect(h.requests).toHaveLength(2);
    expect(await getGame(db, id)).toMatchObject({ status: "aborted", reason: "provider_error" });
  });

  it("makes a second call in the same job when the first failed quickly", async () => {
    const { h, id } = await afterE4([failure, "e5"]);
    await h.runJobs();
    expect(h.requests).toHaveLength(2);
    expect((await getGame(db, id))?.ply).toBe(2);
  });

  it("stops a runner that lost its lease, so it cannot end a game that has moved on", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const stuck: Reply = async () => (await gate, failure);
    const { h, id } = await afterE4([stuck, "e5", failure, failure]);
    const first = h.runJobs();
    while (h.requests.length === 0) await new Promise((r) => setTimeout(r, 5));
    h.clock.now += 400_000; // the first runner's lease has expired
    await getGameView(h.deps, id, { owner: true });
    await h.jobs.shift()!(); // a second runner plays e5
    expect((await getGame(db, id))?.ply).toBe(2);
    release();
    await first;
    expect(await getGame(db, id)).toMatchObject({ status: "active", ply: 2 });
    expect(h.requests).toHaveLength(2);
  });

  it("holds the lease long enough for a token refresh plus a full call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { h, id } = await afterE4([async () => (await gate, { kind: "move", san: "e5" })]);
    const running = h.runJobs();
    while (h.requests.length === 0) await new Promise((r) => setTimeout(r, 5));
    expect((await getGame(db, id))!.aiLeaseUntil! - h.clock.now).toBeGreaterThanOrEqual(240_000 + 20_000);
    release();
    await running;
  });

  it("starts each AI turn with a clean count of illegal replies", async () => {
    const { h, id } = await afterE4([invalid("a"), invalid("b"), "e5", invalid("c"), invalid("d"), "d5"]);
    await h.runJobs();
    await playerMove(h.deps, id, "player-1", "g1f3", 2);
    await h.runJobs();
    expect(await getGame(db, id)).toMatchObject({ status: "active", ply: 4 });
  });

  it("asks for fresh credentials before retrying after the provider rejects them", async () => {
    const refreshes: boolean[] = [];
    const rejected = { kind: "provider_error", message: "HTTP 401" } as const;
    const replies: Reply[] = [rejected, "e5"];
    let calls = 0;
    const h = harness(db, [], {
      adapterFor: async (_game, options) => {
        refreshes.push(Boolean(options?.refresh));
        return async (request) => {
          const reply = replies[calls++];
          return typeof reply === "string" ? { kind: "move", san: reply } : (reply as typeof rejected);
          void request;
        };
      },
    });
    const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
    const id = created.ok ? created.game.id : "";
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    await h.runJobs();
    expect(refreshes).toEqual([false, true]);
    expect((await getGame(db, id))?.ply).toBe(2);
  });

  it("runs once when two callers start the same turn together", async () => {
    const { h, id } = await afterE4(["e5"]);
    h.jobs.length = 0;
    await Promise.all([runAiTurn(h.deps, id), runAiTurn(h.deps, id)]);
    expect(h.requests).toHaveLength(1);
    expect(await listMoves(db, id)).toHaveLength(2);
  });

  it("does nothing when it is the player's turn, or the game is over or unknown", async () => {
    const { h, id } = await afterE4(["e5"]);
    await h.runJobs();
    await runAiTurn(h.deps, id);
    await runAiTurn(h.deps, "not-a-game");
    expect(h.requests).toHaveLength(1);
  });

  it("ends the game when the AI's move is checkmate", async () => {
    const h = harness(db, ["e5", "Qh4#"]);
    const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
    const id = created.ok ? created.game.id : "";
    await playerMove(h.deps, id, "player-1", "f2f3", 0);
    await h.runJobs();
    await playerMove(h.deps, id, "player-1", "g2g4", 2);
    await h.runJobs();
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "black", reason: "checkmate" });
  });
});

describe("what a turn uses", () => {
  const today = () => usageSince(db, dayKey(NOON));

  it("counts every call to a model, and the input tokens it was billed for", async () => {
    const { h } = await afterE4([invalid("Qh4"), { kind: "move", san: "e5", inputTokens: 812 }]);
    await h.runJobs();
    expect(await today()).toEqual([{ day: "2026-10-09", provider: "codex", model: "gpt-a", calls: 2, tokens: 812 }]);
  });

  it("counts a call the provider refused, but not one that was never made", async () => {
    const refused = await afterE4([failure, "e5"]);
    await refused.h.runJobs();
    expect(await today()).toMatchObject([{ calls: 2 }]);
    await resetDb(db);
    const unconnected = harness(db, [], { adapterFor: async () => null });
    const created = await createGame(unconnected.deps, input({ provider: "codex", model: "gpt-a", effort: "low", color: "black" }));
    expect(created.ok).toBe(true);
    await unconnected.runJobs();
    expect(await today()).toEqual([]);
  });

  it("charges a paid call that does not say what it used as an ordinary one", async () => {
    const h = harness(db, ["e5", { kind: "move", san: "Nc6", inputTokens: 900 }]);
    const created = await createGame(h.deps, input({ provider: "jev", model: "jev-latest", timeControl: "1+0" }));
    const id = created.ok ? created.game.id : "";
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    await playerMove(h.deps, id, "player-1", "g1f3", 2);
    expect(await today()).toEqual([{ day: "2026-10-09", provider: "jev", model: "jev-latest", calls: 2, tokens: 2_400 }]);
  });

  it("counts nothing for the scripted opponent", async () => {
    const h = harness(db, ["e5"]);
    const created = await createGame(h.deps, input());
    await playerMove(h.deps, created.ok ? created.game.id : "", "player-1", "e2e4", 0);
    expect(h.requests).toHaveLength(1);
    expect(await today()).toEqual([]);
  });

  it("closes a free model's budget for an hour when its provider says too many requests", async () => {
    const free = { provider: "openrouter", id: "some/model:free", label: "Free", supportsEffort: false, timeControls: ["20+20"] } as const;
    const game = input({ provider: "openrouter", model: free.id, timeControl: "20+20" });
    const limited = { kind: "provider_error", message: "HTTP 429" } as const;
    const h = harness(db, [limited], { findModel: async () => ({ ...free, timeControls: [...free.timeControls] }) });
    const created = await createGame(h.deps, game);
    await playerMove(h.deps, created.ok ? created.game.id : "", "player-1", "e2e4", 0);
    await h.runJobs();
    expect(await getGame(db, created.ok ? created.game.id : "")).toMatchObject({ status: "aborted" });
    const refused = { ok: false, error: "no_games_left", blocked: "rate_limited" };
    expect(await createGame(h.deps, { ...game, playerId: "someone-else" })).toEqual(refused);
    h.clock.now += 60 * 60_000;
    expect((await createGame(h.deps, { ...game, playerId: "someone-else" })).ok).toBe(true);
  });
});
