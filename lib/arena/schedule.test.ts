import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { SLOW, harness, type Reply } from "@/test/game";
import type { Db } from "../db/client";
import { activeArenaGame, listArenaGames } from "../db/arena";
import type { OfferedModel } from "../owner/catalog";
import { arenaOrigin, isArenaCall, runAndHandOver } from "./schedule";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// A stand-in for the schedule's secret, not a real one.
const SECRET = "s".repeat(24);
const SLOW_TWO: OfferedModel = { ...SLOW, id: "gpt-b", label: "GPT B" };
const FOOLS_MATE = ["f3", "e5", "g4", "Qh4#"];
/** A model that takes five minutes over each move. */
const slowly: Reply = (request, clock) => {
  clock.now += 300_000;
  return { kind: "move", san: FOOLS_MATE[request.history.length] };
};

const calls = () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

describe("runAndHandOver", () => {
  const entrants = async () => [SLOW, SLOW_TWO];

  it("asks for another run when the game outlasts this one, and that run finishes it", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const fetcher = calls();
    const h = harness(db, [slowly], { entrants });
    await runAndHandOver(h.deps, { start: true, origin: "https://gambit.test" });
    expect((await activeArenaGame(db))?.ply).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gambit.test/api/arena/tick?continue=1");
    expect(init.headers).toEqual({ authorization: `Bearer ${SECRET}` });

    await runAndHandOver(h.deps, { start: false, origin: "https://gambit.test" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await listArenaGames(db, 5)).toMatchObject([{ status: "finished", result: "black", rated: true }]);
  });

  it("asks nobody when the game is over, or when there is no schedule to ask", async () => {
    const fetcher = calls();
    await runAndHandOver(harness(db, [slowly], { entrants }).deps, { start: true, origin: "https://gambit.test" });
    expect((await activeArenaGame(db))?.ply).toBe(2);
    vi.stubEnv("CRON_SECRET", SECRET);
    await runAndHandOver(harness(db, FOOLS_MATE.slice(2), { entrants }).deps, { start: false, origin: "https://gambit.test" });
    expect(await activeArenaGame(db)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a hand-over that was refused", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const h = harness(db, [slowly], { entrants });
    await expect(runAndHandOver(h.deps, { start: true, origin: "https://gambit.test" })).rejects.toThrow(/HTTP 404/);
  });
});

describe("isArenaCall", () => {
  const call = (authorization?: string) =>
    isArenaCall(new Request("https://gambit.test/api/arena/tick", { headers: authorization ? { authorization } : {} }));

  it("accepts only the schedule's secret, and nothing at all when none is set", () => {
    expect(call(`Bearer ${SECRET}`)).toBe(false);
    vi.stubEnv("CRON_SECRET", "");
    expect(call("Bearer ")).toBe(false);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(call(`Bearer ${SECRET}`)).toBe(true);
    expect(call(`Bearer ${SECRET}x`)).toBe(false);
    expect(call(SECRET)).toBe(false);
    expect(call()).toBe(false);
  });
});

describe("arenaOrigin", () => {
  const request = new Request("http://localhost:3000/api/owner/arena");

  it("is the production site when deployed, and the request's own site otherwise", () => {
    expect(arenaOrigin(request)).toBe("http://localhost:3000");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "gambit.example");
    expect(arenaOrigin(request)).toBe("https://gambit.example");
  });
});
