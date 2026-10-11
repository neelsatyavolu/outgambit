import { MIN_PASSWORD_LENGTH, RESET_LINK_DEAD, resetSchema } from "@/lib/account/input";
import { resetPassword } from "@/lib/account/reset";
import { getDb } from "@/lib/db/client";
import { hitRateLimit } from "@/lib/db/rate-limit";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { ipHashOf, startAccountSession } from "@/lib/server/context";

const WINDOW_MS = 15 * 60_000;
const ATTEMPTS_PER_ADDRESS = 10;

/** Sets a new password with the token from a reset email, and signs this browser in. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const db = await getDb();
  const now = Date.now();
  if (!(await hitRateLimit(db, `account-reset:${ipHashOf(request)}`, ATTEMPTS_PER_ADDRESS, WINDOW_MS, now))) {
    return fail("Too many attempts. Try again in 15 minutes.", 429);
  }
  const body = await readBody(request, resetSchema);
  if (!body) return fail(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  // The reset has ended every session the account had. This starts the one new one.
  const userId = await resetPassword(db, { ...body, now });
  if (!userId) return fail(RESET_LINK_DEAD, 400);
  await startAccountSession(userId);
  return ok({ reset: true });
}
