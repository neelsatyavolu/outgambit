import { forgotSchema, RESET_REQUESTED } from "@/lib/account/input";
import { issueReset } from "@/lib/account/reset";
import { resetLink, sendResetLink } from "@/lib/account/reset-mail";
import { getDb } from "@/lib/db/client";
import { hitRateLimit } from "@/lib/db/rate-limit";
import { findUserByEmail } from "@/lib/db/users";
import { env } from "@/lib/env";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { ipHashOf } from "@/lib/server/context";

const WINDOW_MS = 15 * 60_000;
const ATTEMPTS_PER_ADDRESS = 5;
const HOUR_MS = 60 * 60_000;
// Keeps one person's inbox from being filled by someone else asking over and over.
const LINKS_PER_EMAIL = 3;
const DAY_MS = 24 * HOUR_MS;
// Resend's free plan sends 100 emails a day, and two other apps share it.
const LINKS_PER_DAY = 50;

// The one answer, whether or not the address has an account and whether or not
// a limit kept the email from going out, so the form cannot be used to find out who plays here.
const requested = () => ok({ message: RESET_REQUESTED });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const db = await getDb();
  const now = Date.now();
  if (!(await hitRateLimit(db, `account-forgot:${ipHashOf(request)}`, ATTEMPTS_PER_ADDRESS, WINDOW_MS, now))) {
    return fail("Too many attempts. Try again in 15 minutes.", 429);
  }
  const body = await readBody(request, forgotSchema);
  if (!body) return fail("Enter a valid email.", 400);
  if (!(await hitRateLimit(db, `account-forgot-email:${body.email}`, LINKS_PER_EMAIL, HOUR_MS, now))) return requested();
  const user = await findUserByEmail(db, body.email);
  if (!user) return requested();
  if (!(await hitRateLimit(db, "account-forgot-sent", LINKS_PER_DAY, DAY_MS, now))) {
    console.error("[gambit] the day's reset emails are used up, so one was not sent");
    return requested();
  }
  const token = await issueReset(db, user.id, now);
  try {
    await sendResetLink(user.email, resetLink(env().APP_URL, token), env().RESEND_API_KEY);
  } catch (error) {
    // Only the error's own words: never the link, the address it was for, or the key.
    console.error("[gambit] reset email not sent:", error instanceof Error ? error.message : "unknown error");
    return fail("The reset email could not be sent. Try again later.", 502);
  }
  return requested();
}
