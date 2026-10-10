import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { NOON } from "@/test/factory";
import { harness, input } from "@/test/game";
import type { Db } from "../db/client";
import { getGame } from "../db/games";
import { createGame } from "./create";
import { playerMove } from "./move";
import { getGameView } from "./state";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const player = { playerId: "player-1", owner: false };
const owner = { owner: true };

async function slowGame(replies: string[] = ["e5"]) {
  const h = harness(db, replies);
  const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
  if (!created.ok) throw new Error(created.error);
  return { h, id: created.game.id };
}

describe("getGameView", () => {
  it("shows the player their game with running clocks", async () => {
    const { h, id } = await slowGame();
    h.clock.now = NOON + 7_000;
    expect(await getGameView(h.deps, id, player)).toMatchObject({
      id, status: "active", playerColor: "white", provider: "codex", modelLabel: "GPT A", effort: "low",
      timeControl: "10+10", turn: "white", moves: [], whiteMs: 593_000, blackMs: 600_000, serverNow: NOON + 7_000,
    });
  });

  it("includes the moves played", async () => {
    const { h, id } = await slowGame();
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    await h.runJobs();
    const view = await getGameView(h.deps, id, player);
    expect(view?.moves.map((m) => m.san)).toEqual(["e4", "e5"]);
    expect(view?.turn).toBe("white");
  });

  it("never exposes who is playing", async () => {
    const { h, id } = await slowGame();
    const view = await getGameView(h.deps, id, owner);
    expect(JSON.stringify(view)).not.toContain("player-1");
    expect(JSON.stringify(view)).not.toContain("ip-1");
  });

  it("hides a game from other visitors but shows it to the owner", async () => {
    const { h, id } = await slowGame();
    expect(await getGameView(h.deps, id, { playerId: "intruder", owner: false })).toBeNull();
    expect(await getGameView(h.deps, id, { owner: false })).toBeNull();
    expect((await getGameView(h.deps, id, owner))?.id).toBe(id);
  });

  it("returns null for an unknown game", async () => {
    expect(await getGameView(harness(db).deps, "not-a-game", owner)).toBeNull();
  });

  it("ends the game when the player has run out of time", async () => {
    const { h, id } = await slowGame();
    h.clock.now = NOON + 600_000;
    expect(await getGameView(h.deps, id, player)).toMatchObject({
      status: "finished", result: "black", reason: "timeout", whiteMs: 0,
    });
  });

  it("ends the game when the AI has run out of time", async () => {
    const { h, id } = await slowGame();
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    h.jobs.length = 0;
    h.clock.now = NOON + 601_000;
    expect(await getGameView(h.deps, id, owner)).toMatchObject({ status: "finished", result: "white", reason: "timeout", blackMs: 0 });
  });

  it("restarts an AI turn that was never picked up", async () => {
    const { h, id } = await slowGame();
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    h.jobs.length = 0; // the scheduled turn was lost
    await getGameView(h.deps, id, player);
    expect(h.jobs).toHaveLength(1);
    await h.runJobs();
    expect((await getGame(db, id))?.ply).toBe(2);
  });

  it("leaves a running AI turn alone until its lease expires", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness(db, [async () => (await gate, { kind: "move", san: "e5" })]);
    const created = await createGame(h.deps, input({ provider: "codex", model: "gpt-a", effort: "low" }));
    const id = created.ok ? created.game.id : "";
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    const running = h.runJobs();
    while (h.requests.length === 0) await new Promise((r) => setTimeout(r, 5));
    await getGameView(h.deps, id, player);
    expect(h.jobs).toHaveLength(0);
    release();
    await running;
  });

  it("starts the AI once when two polls arrive after a lease expired", async () => {
    const { h, id } = await slowGame();
    await playerMove(h.deps, id, "player-1", "e2e4", 0);
    h.jobs.length = 0;
    await Promise.all([getGameView(h.deps, id, player), getGameView(h.deps, id, owner)]);
    await Promise.all(h.jobs.splice(0).map((job) => job()));
    expect(h.requests).toHaveLength(1);
    expect((await getGame(db, id))?.ply).toBe(2);
  });

  it("does not schedule anything on the player's turn", async () => {
    const { h, id } = await slowGame();
    await getGameView(h.deps, id, player);
    expect(h.jobs).toHaveLength(0);
  });

  it("stops the clocks once the game is over", async () => {
    const { h, id } = await slowGame();
    h.clock.now = NOON + 600_000;
    await getGameView(h.deps, id, player);
    h.clock.now = NOON + 900_000;
    expect(await getGameView(h.deps, id, player)).toMatchObject({ whiteMs: 0, blackMs: 600_000 });
  });
});
