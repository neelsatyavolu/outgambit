import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { hitRateLimit } from "@/lib/db/rate-limit";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { OWNER_COOKIE, SESSION_TTL_MS, checkPassword, createSession } from "@/lib/owner/session";
import { ipHashOf, secureCookies } from "@/lib/server/context";

const schema = z.object({ password: z.string().min(1).max(500) });
const ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const now = Date.now();
  const allowed = await hitRateLimit(await getDb(), `login:${ipHashOf(request)}`, ATTEMPTS, WINDOW_MS, now);
  if (!allowed) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const body = await readBody(request, schema);
  if (!body || !checkPassword(body.password)) return fail("Wrong password.", 401);
  (await cookies()).set(OWNER_COOKIE, createSession(now), {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookies(),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return ok({ owner: true });
}
