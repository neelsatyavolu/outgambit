import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_COOKIE } from "@/lib/account/session";
import { OWNER_COOKIE, createSession } from "@/lib/owner/session";
import { PLAYER_COOKIE } from "@/lib/server/context";

// The route handlers run for real against an in-memory database. Only the
// two framework entry points they need are replaced: the cookie jar and the
// "run after the response" hook.
type Cookie = { value: string; options?: Record<string, unknown> };
const jar = new Map<string, Cookie>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.set(name, { value, options }),
    delete: (name: string | { name: string }) => void jar.delete(typeof name === "string" ? name : name.name),
  }),
}));
vi.mock("next/server", () => ({ after: () => undefined }));

const SITE = "http://gambit.test";

function request(method: string, path: string, options: { body?: unknown; origin?: string | null; ip?: string } = {}) {
  const origin = options.origin === undefined ? SITE : options.origin;
  return new Request(`${SITE}${path}`, {
    method,
    headers: {
      host: "gambit.test",
      "x-forwarded-for": options.ip ?? "198.51.100.1",
      ...(origin ? { origin } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const signInAsOwner = () => void jar.set(OWNER_COOKIE, { value: createSession(Date.now()) });

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Route = { name: string; method: string; path: string; load: () => Promise<Record<string, unknown>>; params?: Record<string, string> };

const provider = { provider: "gemini" };
const OWNER_ROUTES: Route[] = [
  { name: "list connections", method: "GET", path: "/api/owner/connections", load: () => import("./owner/connections/route") },
  { name: "save a key", method: "PUT", path: "/api/owner/connections/gemini", load: () => import("./owner/connections/[provider]/route"), params: provider },
  { name: "disconnect", method: "DELETE", path: "/api/owner/connections/gemini", load: () => import("./owner/connections/[provider]/route"), params: provider },
  { name: "sign in to a provider", method: "POST", path: "/api/owner/connections/grok/oauth", load: () => import("./owner/connections/[provider]/oauth/route"), params: { provider: "grok" } },
  { name: "test a connection", method: "POST", path: "/api/owner/connections/gemini/test", load: () => import("./owner/connections/[provider]/test/route"), params: provider },
  { name: "list models", method: "GET", path: "/api/owner/models", load: () => import("./owner/models/route") },
  { name: "add a model", method: "POST", path: "/api/owner/models", load: () => import("./owner/models/route") },
  { name: "toggle a model", method: "PATCH", path: "/api/owner/models", load: () => import("./owner/models/route") },
  { name: "remove a model", method: "DELETE", path: "/api/owner/models", load: () => import("./owner/models/route") },
  { name: "list games", method: "GET", path: "/api/owner/games", load: () => import("./owner/games/route") },
  { name: "suggest free models", method: "GET", path: "/api/owner/models/suggestions", load: () => import("./owner/models/suggestions/route") },
];

const id = { id: randomUUID() };
const WRITE_ROUTES: Route[] = [
  ...OWNER_ROUTES.filter((r) => r.method !== "GET"),
  { name: "owner login", method: "POST", path: "/api/owner/login", load: () => import("./owner/login/route") },
  { name: "owner logout", method: "POST", path: "/api/owner/logout", load: () => import("./owner/logout/route") },
  { name: "start a game", method: "POST", path: "/api/games", load: () => import("./games/route") },
  { name: "move", method: "POST", path: `/api/games/${id.id}/moves`, load: () => import("./games/[id]/moves/route"), params: id },
  { name: "resign", method: "POST", path: `/api/games/${id.id}/resign`, load: () => import("./games/[id]/resign/route"), params: id },
  { name: "register", method: "POST", path: "/api/account/register", load: () => import("./account/register/route") },
  { name: "account login", method: "POST", path: "/api/account/login", load: () => import("./account/login/route") },
  { name: "account logout", method: "POST", path: "/api/account/logout", load: () => import("./account/logout/route") },
];

async function call(route: Route, options: Parameters<typeof request>[2] = {}): Promise<Response> {
  const handler = (await route.load())[route.method] as Handler;
  return handler(request(route.method, route.path, { body: {}, ...options }), params(route.params ?? {}));
}

beforeEach(() => jar.clear());
afterEach(() => vi.unstubAllEnvs());

describe("owner routes", () => {
  it.each(OWNER_ROUTES)("$name is refused without an owner session", async (route) => {
    const response = await call(route, route.method === "GET" ? { body: undefined } : {});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Sign in as the owner first." });
  });

  it("refuses a session signed with the wrong key", async () => {
    jar.set(OWNER_COOKIE, { value: `owner.${Date.now() + 60_000}.x.forged` });
    expect((await call(OWNER_ROUTES[0], { body: undefined })).status).toBe(401);
  });

  it("answers the signed-in owner, and never includes a secret", async () => {
    signInAsOwner();
    const { PUT } = await import("./owner/connections/[provider]/route");
    const saved = await PUT(request("PUT", "/api/owner/connections/gemini", { body: { apiKey: "g-secret-key-123" } }), params(provider));
    expect(saved.status).toBe(200);
    const listed = await call(OWNER_ROUTES[0], { body: undefined });
    const text = await listed.text();
    expect(JSON.parse(text).data.find((c: { provider: string }) => c.provider === "gemini").connected).toBe(true);
    expect(text).not.toContain("g-secret-key-123");
  });
});

describe("state-changing routes", () => {
  it.each(WRITE_ROUTES)("$name is refused from another site", async (route) => {
    signInAsOwner();
    expect((await call(route, { origin: "https://evil.test" })).status).toBe(403);
  });

  it.each(WRITE_ROUTES)("$name is refused with no Origin header", async (route) => {
    signInAsOwner();
    expect((await call(route, { origin: null })).status).toBe(403);
  });
});

describe("adding a model", () => {
  it("refuses a paid model with the reason", async () => {
    signInAsOwner();
    const { POST } = await import("./owner/models/route");
    const body = { provider: "openrouter", id: "openai/gpt-6-astra", label: "Astra", supportsEffort: true };
    const response = await POST(request("POST", "/api/owner/models", { body }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(":free");
  });
});

describe("owner login", () => {
  const login = (password: string, ip: string) =>
    import("./owner/login/route").then(({ POST }) => POST(request("POST", "/api/owner/login", { body: { password }, ip })));

  it("rejects a wrong password and sets no cookie", async () => {
    expect((await login("wrong-password", "198.51.100.20")).status).toBe(401);
    expect(jar.has(OWNER_COOKIE)).toBe(false);
  });

  it("sets a session cookie scripts cannot read and other sites cannot send", async () => {
    expect((await login("test-owner-password", "198.51.100.21")).status).toBe(200);
    expect(jar.get(OWNER_COOKIE)?.options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
  });

  it("locks out an address after five attempts, even with the right password", async () => {
    for (let i = 0; i < 5; i++) await login("wrong-password", "198.51.100.22");
    expect((await login("test-owner-password", "198.51.100.22")).status).toBe(429);
  });
});

const PASSWORD = "correct horse battery";
const SKILL = { kind: "level", level: "intermediate" } as const;
const someone = () => ({ email: `${randomUUID()}@example.com`, password: PASSWORD });
/** Registers through the route. A body with no `skill` gets the default one. */
const register = async (body: unknown, ip = "198.51.100.40") => {
  const full = body && typeof body === "object" && !("skill" in body) ? { ...body, skill: SKILL } : body;
  return (await import("./account/register/route")).POST(request("POST", "/api/account/register", { body: full, ip }));
};
const GAME = { provider: "fake", model: "fake-1", effort: null, timeControl: "5+0", color: "white" };
const postGame = async (ip: string, body: unknown = GAME) =>
  (await import("./games/route")).POST(request("POST", "/api/games", { body, ip }));

/** Starts a game against the scripted opponent, creating an account first if this browser has none. */
async function startGame(ip: string): Promise<string> {
  vi.stubEnv("GAMBIT_FAKE_AI", "1");
  vi.stubEnv("GAMBIT_FAKE_SCRIPT", "e5");
  if (!jar.has(ACCOUNT_COOKIE)) expect((await register(someone(), ip)).status).toBe(201);
  const response = await postGame(ip);
  expect(response.status).toBe(201);
  return (await response.json()).data.id as string;
}
const view = async (gameId: string) =>
  (await import("./games/[id]/route")).GET(request("GET", `/api/games/${gameId}`, { origin: null }), params({ id: gameId }));
const move = async (gameId: string, body: unknown) =>
  (await import("./games/[id]/moves/route")).POST(request("POST", `/api/games/${gameId}/moves`, { body }), params({ id: gameId }));
const resign = async (gameId: string) =>
  (await import("./games/[id]/resign/route")).POST(request("POST", `/api/games/${gameId}/resign`), params({ id: gameId }));

describe("player routes", () => {
  it("gives a new visitor an id cookie scripts cannot read", async () => {
    const { GET } = await import("./lobby/route");
    const response = await GET(request("GET", "/api/lobby", { origin: null, ip: "198.51.100.30" }));
    expect((await response.json()).data.capacity.player).toEqual({ used: 0, limit: 5 });
    expect(jar.get(PLAYER_COOKIE)?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("plays a move and returns the opponent's reply in the same response", async () => {
    const gameId = await startGame("198.51.100.31");
    const response = await move(gameId, { move: "e2e4", ply: 0 });
    expect(response.status).toBe(200);
    expect((await response.json()).data.moves.map((m: { san: string }) => m.san)).toEqual(["e4", "e5"]);
  });

  it("rejects a move that is malformed or not sent as JSON", async () => {
    const gameId = await startGame("198.51.100.32");
    expect((await move(gameId, { move: "e2e4; DROP TABLE games", ply: 0 })).status).toBe(400);
    const { POST } = await import("./games/[id]/moves/route");
    const plain = new Request(`${SITE}/api/games/${gameId}/moves`, {
      method: "POST",
      headers: { host: "gambit.test", origin: SITE, "content-type": "text/plain" },
      body: JSON.stringify({ move: "e2e4", ply: 0 }),
    });
    expect((await POST(plain, params({ id: gameId }))).status).toBe(400);
  });

  it("hides a game from every other visitor, but not from the owner", async () => {
    const gameId = await startGame("198.51.100.33");
    expect((await view(gameId)).status).toBe(200);

    jar.clear();
    jar.set(PLAYER_COOKIE, { value: randomUUID() });
    expect((await view(gameId)).status).toBe(404);
    expect((await move(gameId, { move: "e2e4", ply: 0 })).status).toBe(404);
    expect((await resign(gameId)).status).toBe(409);

    jar.delete(PLAYER_COOKIE);
    expect((await view(gameId)).status).toBe(404);
    signInAsOwner();
    const watched = await view(gameId);
    expect(watched.status).toBe(200);
    expect(await watched.text()).not.toMatch(/playerId|ipHash/);
  });

  it("does not let a guest start a game", async () => {
    vi.stubEnv("GAMBIT_FAKE_AI", "1");
    const response = await postGame("198.51.100.35");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Create an account or sign in to play." });
  });

  it("does not let an account play before it has said how strong it is", async () => {
    vi.stubEnv("GAMBIT_FAKE_AI", "1");
    await register(someone(), "198.51.100.36");
    const { getDb } = await import("@/lib/db/client");
    await (await getDb()).query("UPDATE users SET bullet_rating = NULL, regular_rating = NULL");
    const response = await postGame("198.51.100.36");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/how strong/i);
  });

  it("shows both sides' rating change when a game ends", async () => {
    const gameId = await startGame("198.51.100.37");
    expect((await resign(gameId)).status).toBe(200);
    const { data } = await (await view(gameId)).json();
    expect(data).toMatchObject({ status: "finished", pool: "bullet", rating: { playerBefore: 1200, aiBefore: 700 } });
    expect(data.rating.playerAfter).toBeLessThan(1200);
    expect(data.rating.aiAfter).toBeGreaterThan(700);
  });

  it("tells the setup screen who is signed in and how every opponent is rated", async () => {
    vi.stubEnv("GAMBIT_FAKE_AI", "1");
    const lobby = async () =>
      (await (await import("./lobby/route")).GET(request("GET", "/api/lobby", { origin: null, ip: "198.51.100.38" }))).json();
    expect((await lobby()).data.account).toBeNull();
    const ada = someone();
    await register(ada, "198.51.100.38");
    const { data } = await lobby();
    expect(data.account).toEqual({ email: ada.email, ratings: { regular: 1300, bullet: 1200 }, needsSkill: false });
    // Other tests in this file have played the scripted opponent, so only the shape is fixed here.
    const line = (pool: string) =>
      expect.objectContaining({ provider: "fake", id: "fake-1", label: "Scripted", effort: null, pool, rating: expect.any(Number), games: expect.any(Number) });
    expect(data.ratings).toEqual([line("bullet"), line("regular")]);
  });

  it("refuses the scripted opponent when it is switched off", async () => {
    await register(someone(), "198.51.100.34");
    expect((await postGame("198.51.100.34")).status).toBe(400);
  });
});

describe("accounts", () => {
  const login = async (body: unknown, ip = "198.51.100.41") =>
    (await import("./account/login/route")).POST(request("POST", "/api/account/login", { body, ip }));
  const logout = async () => (await import("./account/logout/route")).POST(request("POST", "/api/account/logout"));
  const account = async () => (await import("./account/route")).GET();

  it("registers a visitor and signs them in with a cookie scripts cannot read", async () => {
    const ada = someone();
    expect((await register(ada)).status).toBe(201);
    expect(jar.get(ACCOUNT_COOKIE)?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const response = await account();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).data.email).toBe(ada.email);
    expect(text).not.toMatch(/passwordHash|scrypt|playerId|ipHash/);
  });

  it("refuses an email that is already registered", async () => {
    const ada = someone();
    await register(ada);
    jar.clear();
    const response = await register({ ...ada, email: ada.email.toUpperCase() }, "198.51.100.42");
    expect(response.status).toBe(409);
    expect(jar.has(ACCOUNT_COOKIE)).toBe(false);
  });

  it.each([
    { name: "a malformed email", body: { email: "not-an-email", password: PASSWORD } },
    { name: "a password under eight characters", body: { email: "short@example.com", password: "1234567" } },
    { name: "a missing password", body: { email: "none@example.com" } },
  ])("refuses to register with $name", async ({ body }) => {
    expect((await register(body, "198.51.100.43")).status).toBe(400);
    expect(jar.has(ACCOUNT_COOKIE)).toBe(false);
  });

  it("signs in with the right password only", async () => {
    const ada = someone();
    await register(ada, "198.51.100.44");
    jar.clear();
    expect((await login({ ...ada, password: "correct horse batterz" }, "198.51.100.44")).status).toBe(401);
    expect(jar.has(ACCOUNT_COOKIE)).toBe(false);
    expect((await login(ada, "198.51.100.44")).status).toBe(200);
    expect((await (await account()).json()).data.email).toBe(ada.email);
  });

  it("does not reveal whether an email is registered when sign-in fails", async () => {
    const ada = someone();
    await register(ada, "198.51.100.45");
    jar.clear();
    const wrongPassword = await (await login({ ...ada, password: "wrong password" }, "198.51.100.45")).json();
    const unknownEmail = await (await login(someone(), "198.51.100.45")).json();
    expect(wrongPassword).toEqual({ success: false, error: "Wrong email or password." });
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it("locks out an address after ten sign-in attempts, even with the right password", async () => {
    const ada = someone();
    await register(ada, "198.51.100.46");
    jar.clear();
    for (let i = 0; i < 10; i++) await login({ email: `${randomUUID()}@example.com`, password: "wrong" }, "198.51.100.47");
    expect((await login(ada, "198.51.100.47")).status).toBe(429);
  });

  it("locks out sign-in to one email attacked from many addresses", async () => {
    const victim = someone();
    for (let i = 0; i < 30; i++) expect((await login(victim, `203.0.113.${i}`)).status).toBe(401);
    expect((await login(victim, "203.0.113.200")).status).toBe(429);
  });

  it("limits how many accounts one address can create", async () => {
    for (let i = 0; i < 5; i++) expect((await register(someone(), "198.51.100.48")).status).toBe(201);
    expect((await register(someone(), "198.51.100.48")).status).toBe(429);
  });

  it("tells a visitor who is not signed in to sign in", async () => {
    const response = await account();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Sign in first." });
  });

  it("forgets a session whose account no longer exists", async () => {
    await register(someone(), "198.51.100.49");
    const { getDb } = await import("@/lib/db/client");
    await (await getDb()).query("DELETE FROM users WHERE id = $1", [jar.get(ACCOUNT_COOKIE)!.value.split(".")[1]]);
    expect((await account()).status).toBe(401);
    expect(jar.has(ACCOUNT_COOKIE)).toBe(false);
  });

  it("requires a new account to say how strong the player is", async () => {
    for (const skill of [undefined, { kind: "level", level: "grandmaster" }, { kind: "chesscom", bullet: 50, regular: 1500 }]) {
      expect((await register({ ...someone(), skill }, "198.51.100.56")).status).toBe(400);
    }
    expect((await register({ ...someone(), skill: { kind: "chesscom", bullet: 1432, regular: 1688 } }, "198.51.100.56")).status).toBe(201);
    expect((await (await account()).json()).data.ratings).toEqual({ regular: 1688, bullet: 1432 });
  });

  it("lets a player correct their strength until their first rated game, and not after", async () => {
    const setSkill = async (skill: unknown) =>
      (await import("./account/skill/route")).PUT(request("PUT", "/api/account/skill", { body: skill }));
    await register(someone(), "198.51.100.57");
    expect((await setSkill({ kind: "level", level: "advanced" })).status).toBe(200);
    expect((await (await account()).json()).data.ratings).toEqual({ regular: 1900, bullet: 1800 });

    const gameId = await startGame("198.51.100.57");
    await resign(gameId);
    await view(gameId);
    const refused = await setSkill({ kind: "level", level: "expert" });
    expect(refused.status).toBe(409);
    const { data } = await (await account()).json();
    expect(data.ratings.regular).toBe(1900);
    expect(data.ratings.bullet).toBeLessThan(1800);
    expect(data.rated).toEqual({ regular: 0, bullet: 1 });
  });

  it("refuses a strength change from a guest or from another site", async () => {
    const { PUT } = await import("./account/skill/route");
    expect((await PUT(request("PUT", "/api/account/skill", { body: SKILL }))).status).toBe(401);
    expect((await PUT(request("PUT", "/api/account/skill", { body: SKILL, origin: "https://evil.test" }))).status).toBe(403);
  });

  it("plays new games under the account, so they follow it to another browser", async () => {
    const ada = someone();
    await register(ada, "198.51.100.51");
    const gameId = await startGame("198.51.100.51");
    expect((await move(gameId, { move: "e2e4", ply: 0 })).status).toBe(200);

    jar.clear();
    expect((await view(gameId)).status).toBe(404);
    await login(ada, "198.51.100.51");
    expect((await view(gameId)).status).toBe(200);
    expect((await (await account()).json()).data.games[0]).toMatchObject({ id: gameId, status: "active" });
  });

  const signedInUserId = () => jar.get(ACCOUNT_COOKIE)!.value.split(".")[1];

  it("does not let an account's id stand in for its session", async () => {
    await register(someone(), "198.51.100.53");
    const gameId = await startGame("198.51.100.53");
    const userId = signedInUserId();
    jar.clear();
    for (const forged of [userId, `account:${userId}`]) {
      jar.set(PLAYER_COOKIE, { value: forged });
      expect((await view(gameId)).status).toBe(404);
      expect((await move(gameId, { move: "e2e4", ply: 0 })).status).toBe(404);
      expect((await resign(gameId)).status).toBe(409);
    }
  });

  it("does not hand an account's games to a visitor who registers with its id as their guest id", async () => {
    const victim = someone();
    await register(victim, "198.51.100.54");
    const gameId = await startGame("198.51.100.54");
    const userId = signedInUserId();

    jar.clear();
    jar.set(PLAYER_COOKIE, { value: userId });
    expect((await register(someone(), "198.51.100.55")).status).toBe(201);
    expect((await (await account()).json()).data.games).toEqual([]);

    jar.clear();
    await login(victim, "198.51.100.54");
    expect((await (await account()).json()).data.games.map((g: { id: string }) => g.id)).toEqual([gameId]);
  });

  it("closes the account's games to the browser on sign-out", async () => {
    await register(someone(), "198.51.100.52");
    const gameId = await startGame("198.51.100.52");
    expect((await logout()).status).toBe(200);
    expect(jar.has(ACCOUNT_COOKIE)).toBe(false);
    expect((await view(gameId)).status).toBe(404);
    expect((await account()).status).toBe(401);
  });
});
