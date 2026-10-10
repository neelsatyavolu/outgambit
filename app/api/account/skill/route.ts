import { chooseSkill } from "@/lib/account/accounts";
import { skillSchema } from "@/lib/account/input";
import { getDb } from "@/lib/db/client";
import { fail, ok, readBody, sameOrigin } from "@/lib/http";
import { accountId } from "@/lib/server/context";

/** Sets where the signed-in player's ratings start. Only possible before their first rated game. */
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  const userId = await accountId();
  if (!userId) return fail("Sign in first.", 401);
  const skill = await readBody(request, skillSchema);
  if (!skill) return fail("Choose a level, or enter your chess.com bullet and rapid ratings (100 to 3500).", 400);
  const changed = await chooseSkill(await getDb(), userId, skill);
  return changed ? ok({ saved: true }) : fail("You have rated games now, so your rating only changes by playing.", 409);
}
