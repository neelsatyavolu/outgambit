import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
];

const id = { id: randomUUID() };
const WRITE_ROUTES: Route[] = [
  ...OWNER_ROUTES.filter((r) => r.method !== "GET"),
  { name: "owner login", method: "POST", path: "/api/owner/login", load: () => import("./owner/login/route") },
  { name: "owner logout", method: "POST", path: "/api/owner/logout", load: () => import("./owner/logout/route") },
  { name: "start a game", method: "POST", path: "/api/games", load: () => import("./games/route") },
  { name: "move", method: "POST", path: `/api/games/${id.id}/moves`, load: () => import("./games/[id]/moves/route"), params: id },
  { name: "resign", method: "POST", path: `/api/games/${id.id}/resign`, load: () => import("./games/[id]/resign/route"), params: id },
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

describe("player routes", () => {
  async function startGame(ip: string): Promise<string> {
    vi.stubEnv("GAMBIT_FAKE_AI", "1");
    vi.stubEnv("GAMBIT_FAKE_SCRIPT", "e5");
    const { POST } = await import("./games/route");
    const body = { provider: "fake", model: "fake-1", effort: null, timeControl: "5+0", color: "white" };
    const response = await POST(request("POST", "/api/games", { body, ip }));
    expect(response.status).toBe(201);
    return (await response.json()).data.id as string;
  }
  const view = async (gameId: string) =>
    (await import("./games/[id]/route")).GET(request("GET", `/api/games/${gameId}`, { origin: null }), params({ id: gameId }));
  const move = async (gameId: string, body: unknown) =>
    (await import("./games/[id]/moves/route")).POST(request("POST", `/api/games/${gameId}/moves`, { body }), params({ id: gameId }));

  it("gives a new visitor an id cookie scripts cannot read", async () => {
    const { GET } = await import("./lobby/route");
    const response = await GET(request("GET", "/api/lobby", { origin: null, ip: "198.51.100.30" }));
    expect((await response.json()).data.capacity.player).toEqual({ used: 0, limit: 2 });
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

    jar.set(PLAYER_COOKIE, { value: randomUUID() });
    expect((await view(gameId)).status).toBe(404);
    expect((await move(gameId, { move: "e2e4", ply: 0 })).status).toBe(404);
    const { POST: resign } = await import("./games/[id]/resign/route");
    expect((await resign(request("POST", `/api/games/${gameId}/resign`), params({ id: gameId }))).status).toBe(409);

    jar.delete(PLAYER_COOKIE);
    expect((await view(gameId)).status).toBe(404);
    signInAsOwner();
    const watched = await view(gameId);
    expect(watched.status).toBe(200);
    expect(await watched.text()).not.toMatch(/playerId|ipHash/);
  });

  it("refuses the scripted opponent when it is switched off", async () => {
    const { POST } = await import("./games/route");
    const body = { provider: "fake", model: "fake-1", effort: null, timeControl: "5+0", color: "white" };
    const response = await POST(request("POST", "/api/games", { body, ip: "198.51.100.34" }));
    expect(response.status).toBe(400);
  });
});
