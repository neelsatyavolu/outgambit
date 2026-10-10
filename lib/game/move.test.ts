import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { NOON } from "@/test/factory";
import { harness, input } from "@/test/game";
import type { Db } from "../db/client";
import { getGame, listMoves } from "../db/games";
import { createGame } from "./create";
import { playerMove, resign } from "./move";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

async function start(h: ReturnType<typeof harness>, overrides = {}) {
  const created = await createGame(h.deps, input(overrides));
  if (!created.ok) throw new Error(created.error);
  return created.game.id;
}

describe("playerMove", () => {
  it("plays the move, charges the clock, and lets a fast AI answer in the same call", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { timeControl: "2+1" });
    h.clock.now = NOON + 5_000;
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: true });
    const game = await getGame(db, id);
    expect(game).toMatchObject({ ply: 2, whiteMs: 116_000, status: "active" });
    expect((await listMoves(db, id)).map((m) => m.san)).toEqual(["e4", "e5"]);
    expect((await listMoves(db, id))[0].spentMs).toBe(5_000);
  });

  it("schedules a slow AI's answer without waiting", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    expect((await getGame(db, id))?.ply).toBe(1);
    await h.runJobs();
    expect((await getGame(db, id))?.ply).toBe(2);
  });

  it("plays a whole game to checkmate", async () => {
    const h = harness(db, ["e5", "Qh4#"]);
    const id = await start(h);
    await playerMove(h.deps, id, "player-1", "f2f3", 0);
    await playerMove(h.deps, id, "player-1", "g2g4", 2);
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "black", reason: "checkmate", ply: 4 });
  });

  it("does not ask the AI to move after the player ends the game", async () => {
    const h = harness(db, ["f6", "g5"]);
    const id = await start(h);
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    await playerMove(h.deps, id, "player-1", "d2d4", 2);
    await playerMove(h.deps, id, "player-1", "d1h5", 4);
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "white", reason: "checkmate" });
    expect(h.requests).toHaveLength(2);
  });

  it("rejects an illegal move and changes nothing", async () => {
    const h = harness(db);
    const id = await start(h);
    expect(await playerMove(h.deps, id, "player-1", "e2e5", 0)).toEqual({ ok: false, error: "illegal_move" });
    expect((await getGame(db, id))?.ply).toBe(0);
  });

  it("rejects a move when it is the AI's turn", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    expect(await playerMove(h.deps, id, "player-1", "d2d4", 1)).toEqual({ ok: false, error: "not_your_turn" });
  });

  it("rejects the same move sent twice and charges the clock once", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h, { provider: "codex", model: "gpt-a", effort: "low" });
    h.clock.now = NOON + 3_000;
    const results = await Promise.all([
      playerMove(h.deps, id, "player-1", "e2e4", 0),
      playerMove(h.deps, id, "player-1", "e2e4", 0),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listMoves(db, id)).toHaveLength(1);
    expect((await getGame(db, id))?.whiteMs).toBe(600_000 - 3_000 + 10_000);
    expect(h.jobs).toHaveLength(1);
  });

  it("rejects a move made for a position the game has left", async () => {
    const h = harness(db, ["e5"]);
    const id = await start(h);
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    expect(await playerMove(h.deps, id, "player-1", "g1f3", 0)).toEqual({ ok: false, error: "stale" });
  });

  it("hides another player's game", async () => {
    const h = harness(db);
    const id = await start(h);
    expect(await playerMove(h.deps, id, "intruder", "e2e4", 0)).toEqual({ ok: false, error: "not_found" });
    expect(await playerMove(h.deps, "not-a-game", "player-1", "e2e4", 0)).toEqual({ ok: false, error: "not_found" });
  });

  it("ends the game when the player moves after their time ran out", async () => {
    const h = harness(db);
    const id = await start(h, { timeControl: "1+0" });
    h.clock.now = NOON + 61_000;
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: false, error: "out_of_time" });
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "black", reason: "timeout", whiteMs: 0, ply: 0 });
  });

  it("rejects a move in a finished game", async () => {
    const h = harness(db);
    const id = await start(h);
    await resign(h.deps, id, "player-1");
    expect(await playerMove(h.deps, id, "player-1", "e2e4", 0)).toEqual({ ok: false, error: "not_active" });
  });
});

describe("resign", () => {
  it("gives the game to the AI", async () => {
    const h = harness(db);
    const id = await start(h, { color: "white" });
    expect(await resign(h.deps, id, "player-1")).toBe(true);
    expect(await getGame(db, id)).toMatchObject({ status: "finished", result: "black", reason: "resignation" });
  });

  it("does nothing for someone else's game or a game already over", async () => {
    const h = harness(db);
    const id = await start(h);
    expect(await resign(h.deps, id, "intruder")).toBe(false);
    await resign(h.deps, id, "player-1");
    expect(await resign(h.deps, id, "player-1")).toBe(false);
  });
});
