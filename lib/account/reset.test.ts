import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { NOON } from "@/test/factory";
import type { Db } from "../db/client";
import { insertReset } from "../db/password-resets";
import { accountIn, register, signIn } from "./accounts";
import { issueReset, resetPassword, RESET_TTL_MS } from "./reset";
import { sign } from "../owner/crypto";
import { createAccountSession } from "./session";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const OLD = "correct horse battery";
const NEW = "a brand new password";
const skill = { kind: "level", level: "intermediate" } as const;
const account = (email = "ada@example.com") => ({ email, password: OLD, guestId: undefined, now: NOON, skill });
const join = async (email?: string) => (await register(db, account(email)))!;
const rows = () => db.query<{ token_hash: string; user_id: string }>("SELECT * FROM password_resets ORDER BY created_at");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("issueReset", () => {
  it("gives out a long random token and keeps only its hash", async () => {
    const userId = await join();
    const token = await issueReset(db, userId, NOON);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await issueReset(db, userId, NOON)).not.toBe(token);
    const stored = await db.query("SELECT * FROM password_resets");
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("stores a token that lasts an hour", async () => {
    const userId = await join();
    const token = await issueReset(db, userId, NOON);
    const [row] = await db.query<{ token_hash: string; user_id: string; expires_at: Date; created_at: Date }>("SELECT * FROM password_resets");
    expect(row).toMatchObject({ token_hash: sha256(token), user_id: userId });
    expect(new Date(row.expires_at).getTime()).toBe(NOON + RESET_TTL_MS);
    expect(new Date(row.created_at).getTime()).toBe(NOON);
    expect(RESET_TTL_MS).toBe(60 * 60_000);
  });

  it("replaces the link the account was sent before", async () => {
    const userId = await join();
    const first = await issueReset(db, userId, NOON);
    const second = await issueReset(db, userId, NOON + 1_000);
    expect(await rows()).toHaveLength(1);
    expect(await resetPassword(db, { token: first, password: NEW, now: NOON + 2_000 })).toBeNull();
    expect(await resetPassword(db, { token: second, password: NEW, now: NOON + 2_000 })).toBe(userId);
  });

  it("clears out links that have expired, and leaves other accounts' live ones", async () => {
    const [ada, bo, cy] = [await join(), await join("bo@example.com"), await join("cy@example.com")];
    await issueReset(db, ada, NOON);
    const live = await issueReset(db, bo, NOON + RESET_TTL_MS - 1);
    await issueReset(db, cy, NOON + RESET_TTL_MS);
    expect((await rows()).map((row) => row.user_id)).toEqual([bo, cy]);
    expect(await resetPassword(db, { token: live, password: NEW, now: NOON + RESET_TTL_MS })).toBe(bo);
  });
});

describe("resetPassword", () => {
  it("replaces the password", async () => {
    const userId = await join();
    const token = await issueReset(db, userId, NOON);
    expect(await resetPassword(db, { token, password: NEW, now: NOON + 1 })).toBe(userId);
    expect(await signIn(db, { ...account(), password: NEW })).toBe(userId);
    expect(await signIn(db, account())).toBeNull();
  });

  it("works once", async () => {
    const userId = await join();
    const token = await issueReset(db, userId, NOON);
    await resetPassword(db, { token, password: NEW, now: NOON + 1 });
    expect(await resetPassword(db, { token, password: "yet another password", now: NOON + 2 })).toBeNull();
    expect(await signIn(db, { ...account(), password: NEW })).toBe(userId);
    expect(await rows()).toEqual([]);
  });

  it("works up to the hour and not at it", async () => {
    const userId = await join();
    const late = await issueReset(db, userId, NOON);
    expect(await resetPassword(db, { token: late, password: NEW, now: NOON + RESET_TTL_MS })).toBeNull();
    expect(await signIn(db, account())).toBe(userId);
    const inTime = await issueReset(db, userId, NOON);
    expect(await resetPassword(db, { token: inTime, password: NEW, now: NOON + RESET_TTL_MS - 1 })).toBe(userId);
  });

  it("refuses a token nobody was sent, and changes nothing", async () => {
    const userId = await join();
    const token = await issueReset(db, userId, NOON);
    for (const guess of ["", "nonsense", sha256(token), `${token}x`]) {
      expect(await resetPassword(db, { token: guess, password: NEW, now: NOON + 1 })).toBeNull();
    }
    expect(await signIn(db, account())).toBe(userId);
    expect(await rows()).toHaveLength(1);
  });

  it("ends every session the account had, and only that account's", async () => {
    const [ada, bo] = [await join(), await join("bo@example.com")];
    const before = createAccountSession(ada, NOON, 0);
    const legacy = sign(`account.${ada}.${NOON + 60_000}`);
    const other = createAccountSession(bo, NOON, 0);
    expect(await accountIn(db, before, NOON)).toBe(ada);
    expect(await accountIn(db, legacy, NOON)).toBe(ada);

    await resetPassword(db, { token: await issueReset(db, ada, NOON), password: NEW, now: NOON + 1 });
    expect(await accountIn(db, before, NOON + 2)).toBeNull();
    expect(await accountIn(db, legacy, NOON + 2)).toBeNull();
    expect(await accountIn(db, createAccountSession(ada, NOON + 2, 1), NOON + 2)).toBe(ada);
    expect(await accountIn(db, other, NOON + 2)).toBe(bo);
  });

  it("uses up any other link the account still had", async () => {
    const [ada, bo] = [await join(), await join("bo@example.com")];
    const token = await issueReset(db, ada, NOON);
    await issueReset(db, bo, NOON);
    // Two requests arriving together can each leave a link behind.
    await insertReset(db, { tokenHash: sha256("a second link"), userId: ada, expiresAt: NOON + RESET_TTL_MS, createdAt: NOON });
    await resetPassword(db, { token, password: NEW, now: NOON + 1 });
    expect((await rows()).map((row) => row.user_id)).toEqual([bo]);
    expect(await resetPassword(db, { token: "a second link", password: OLD, now: NOON + 2 })).toBeNull();
  });

  it("leaves the link usable when the password could not be stored", async () => {
    const userId = await join();
    const token = await issueReset(db, userId, NOON);
    const failing: Db = {
      query: db.query,
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            query: (sql, params) => (sql.startsWith("UPDATE users") ? Promise.reject(new Error("database down")) : tx.query(sql, params)),
          } as typeof tx),
        ),
    };
    await expect(resetPassword(failing, { token, password: NEW, now: NOON + 1 })).rejects.toThrow("database down");
    expect(await signIn(db, account())).toBe(userId);
    expect(await resetPassword(db, { token, password: NEW, now: NOON + 2 })).toBe(userId);
  });
});
