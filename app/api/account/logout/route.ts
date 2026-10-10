import { cookies } from "next/headers";
import { ACCOUNT_COOKIE } from "@/lib/account/session";
import { fail, ok, sameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  (await cookies()).delete(ACCOUNT_COOKIE);
  return ok({ signedIn: false });
}
