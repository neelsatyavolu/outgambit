import { signIn } from "@/lib/account/accounts";
import { loginSchema } from "@/lib/account/input";
import { getDb } from "@/lib/db/client";
import { hitRateLimit } from "@/lib/db/rate-limit";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { guestId, ipHashOf, startAccountSession } from "@/lib/server/context";

const WINDOW_MS = 15 * 60_000;
const ATTEMPTS_PER_ADDRESS = 10;
// Slows guessing spread over many addresses. Set above the per-address limit,
// so it takes several addresses to lock an account's owner out for the window.
const ATTEMPTS_PER_EMAIL = 30;
const LOCKED = "Too many attempts. Try again in 15 minutes.";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const db = await getDb();
  const now = Date.now();
  if (!(await hitRateLimit(db, `account-login:${ipHashOf(request)}`, ATTEMPTS_PER_ADDRESS, WINDOW_MS, now))) {
    return fail(LOCKED, 429);
  }
  const body = await readBody(request, loginSchema);
  if (!body) return fail("Wrong email or password.", 401);
  if (!(await hitRateLimit(db, `account-login-email:${body.email}`, ATTEMPTS_PER_EMAIL, WINDOW_MS, now))) {
    return fail(LOCKED, 429);
  }
  const userId = await signIn(db, { ...body, guestId: await guestId() });
  if (!userId) return fail("Wrong email or password.", 401);
  await startAccountSession(userId);
  return ok({ email: body.email });
}
