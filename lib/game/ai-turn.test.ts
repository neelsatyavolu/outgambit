import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { NOON } from "@/test/factory";
import { harness, input, type Reply } from "@/test/game";
import type { Db } from "../db/client";
import { getGame, listMoves } from "../db/games";
import { callTimeoutMs, runAiTurn } from "./ai-turn";
import { createGame } from "./create";
import { capacity } from "./limits";
import { playerMove } from "./move";

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
  const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "high", ...overrides }));
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
      history: ["e4"], color: "black", model: "gpt-a", effort: "high", remainingMs: 580_000,
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
    expect((await capacity(db, "player-1", "ip-1", NOON)).player.used).toBe(0);
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
    expect(callTimeoutMs(600_000)).toBe(240_000);
    expect(callTimeoutMs(45_000)).toBe(45_000);
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
