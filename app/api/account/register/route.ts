import { register } from "@/lib/account/accounts";
import { MIN_PASSWORD_LENGTH, registerSchema } from "@/lib/account/input";
import { getDb } from "@/lib/db/client";
import { hitRateLimit } from "@/lib/db/rate-limit";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { guestId, ipHashOf, startAccountSession } from "@/lib/server/context";

const ACCOUNTS = 5;
const WINDOW_MS = 60 * 60_000;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const db = await getDb();
  const now = Date.now();
  const allowed = await hitRateLimit(db, `account-register:${ipHashOf(request)}`, ACCOUNTS, WINDOW_MS, now);
  if (!allowed) return fail("Too many new accounts from this network. Try again in an hour.", 429);
  const body = await readBody(request, registerSchema);
  if (!body) return fail(`Enter a valid email and a password of at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  const userId = await register(db, { ...body, guestId: await guestId(), now });
  if (!userId) return fail("That email already has an account. Sign in instead.", 409);
  await startAccountSession(userId);
  return ok({ email: body.email }, 201);
}
