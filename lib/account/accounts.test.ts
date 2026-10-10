import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { makeGame, NOON } from "@/test/factory";
import type { Db } from "../db/client";
import { getGame, insertGame } from "../db/games";
import { findUserByEmail } from "../db/users";
import { register, signIn } from "./accounts";
import { accountPlayerId } from "./session";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const GUEST = "guest-cookie-1";
const details = { email: "ada@example.com", password: "correct horse battery", guestId: GUEST, now: NOON };

describe("register", () => {
  it("creates an account that does not hold the password", async () => {
    const id = await register(db, details);
    const user = await findUserByEmail(db, "ada@example.com");
    expect(user).toMatchObject({ id, email: "ada@example.com", createdAt: NOON });
    expect(user!.passwordHash).not.toContain(details.password);
  });

  it("stores the email trimmed and in lower case", async () => {
    await register(db, { ...details, email: "  Ada@Example.COM " });
    expect(await findUserByEmail(db, "ada@example.com")).not.toBeNull();
  });

  it("refuses an email that already has an account, whatever its case", async () => {
    await register(db, details);
    expect(await register(db, { ...details, email: "ADA@example.com", password: "another password" })).toBeNull();
  });

  it("moves the games played on this browser to the new account", async () => {
    const mine = makeGame({ playerId: GUEST });
    const theirs = makeGame({ playerId: "someone-else" });
    await insertGame(db, mine);
    await insertGame(db, theirs);
    const id = await register(db, details);
    expect((await getGame(db, mine.id))!.playerId).toBe(accountPlayerId(id!));
    expect((await getGame(db, theirs.id))!.playerId).toBe("someone-else");
  });

  it("creates no account when the browser's games cannot be moved", async () => {
    const game = makeGame({ playerId: GUEST });
    await insertGame(db, game);
    const failing: Db = {
      query: db.query,
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            query: (sql, params) => (sql.startsWith("UPDATE games") ? Promise.reject(new Error("database down")) : tx.query(sql, params)),
          } as typeof tx),
        ),
    };
    await expect(register(failing, details)).rejects.toThrow("database down");
    expect(await findUserByEmail(db, details.email)).toBeNull();
    expect((await getGame(db, game.id))!.playerId).toBe(GUEST);
  });

  it("works for a browser that has no guest id yet", async () => {
    expect(await register(db, { ...details, guestId: undefined })).toEqual(expect.any(String));
  });
});

describe("signIn", () => {
  it("returns the account for the right password, however the email is typed", async () => {
    const id = await register(db, details);
    expect(await signIn(db, { ...details, email: " ADA@example.com" })).toBe(id);
  });

  it("refuses a wrong password", async () => {
    await register(db, details);
    expect(await signIn(db, { ...details, password: "correct horse batterz" })).toBeNull();
  });

  it("refuses an email with no account", async () => {
    expect(await signIn(db, details)).toBeNull();
  });

  it("moves the games played on this browser to the account", async () => {
    const id = await register(db, { ...details, guestId: undefined });
    const game = makeGame({ playerId: "another-browser" });
    await insertGame(db, game);
    await signIn(db, { ...details, guestId: "another-browser" });
    expect((await getGame(db, game.id))!.playerId).toBe(accountPlayerId(id!));
  });

  it("leaves a browser's games alone when the password is wrong", async () => {
    await register(db, { ...details, guestId: undefined });
    const game = makeGame({ playerId: GUEST });
    await insertGame(db, game);
    await signIn(db, { ...details, password: "wrong password" });
    expect((await getGame(db, game.id))!.playerId).toBe(GUEST);
  });
});
