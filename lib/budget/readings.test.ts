import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { NOON } from "@/test/factory";
import type { Db } from "../db/client";
import { reading } from "./readings";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const MINUTE = 60_000;

/** A source that answers with each of `replies` in turn, counting how often it is asked. */
function source(replies: Array<{ n: number } | string | Error>) {
  const state = { asked: 0 };
  const load = async () => {
    const reply = replies[Math.min(state.asked++, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { state, load };
}

describe("reading", () => {
  it("reads a figure and keeps it for five minutes", async () => {
    const { state, load } = source([{ n: 1 }, { n: 2 }]);
    expect(await reading(db, "x", NOON, load)).toEqual({ value: { n: 1 }, readAt: NOON, error: null });
    expect(await reading(db, "x", NOON + 4 * MINUTE, load)).toEqual({ value: { n: 1 }, readAt: NOON, error: null });
    expect(state.asked).toBe(1);
    expect(await reading(db, "x", NOON + 5 * MINUTE, load)).toEqual({ value: { n: 2 }, readAt: NOON + 5 * MINUTE, error: null });
  });

  it("keeps each figure under its own name", async () => {
    await reading(db, "x", NOON, source([{ n: 1 }]).load);
    expect((await reading(db, "y", NOON, source([{ n: 9 }]).load)).value).toEqual({ n: 9 });
  });

  it("keeps the last good figure when a later read fails, and says why", async () => {
    const { load } = source([{ n: 1 }, "HTTP 503"]);
    await reading(db, "x", NOON, load);
    expect(await reading(db, "x", NOON + 10 * MINUTE, load)).toEqual({ value: { n: 1 }, readAt: NOON, error: "HTTP 503" });
  });

  it("asks again a minute after a failure, not sooner", async () => {
    const { state, load } = source(["HTTP 503", "HTTP 503", { n: 3 }]);
    await reading(db, "x", NOON, load);
    await reading(db, "x", NOON + 59_000, load);
    expect(state.asked).toBe(1);
    await reading(db, "x", NOON + MINUTE, load);
    expect((await reading(db, "x", NOON + 2 * MINUTE, load)).value).toEqual({ n: 3 });
    expect(state.asked).toBe(3);
  });

  it("stops trusting a figure an hour old", async () => {
    const { load } = source([{ n: 1 }, "HTTP 503"]);
    await reading(db, "x", NOON, load);
    expect(await reading(db, "x", NOON + 60 * MINUTE, load)).toEqual({ value: null, readAt: NOON, error: "HTTP 503" });
  });

  it("has nothing to offer when the first read fails", async () => {
    expect(await reading(db, "x", NOON, source(["not connected"]).load)).toEqual({ value: null, readAt: null, error: "not connected" });
  });

  it("treats a source that throws as a failed read", async () => {
    expect(await reading(db, "x", NOON, source([new TypeError("boom")]).load)).toMatchObject({ value: null, error: "TypeError" });
  });
});
