import { cookies } from "next/headers";
import { fail, ok, sameOrigin } from "@/lib/http";
import { OWNER_COOKIE } from "@/lib/owner/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Request refused.", 403);
  (await cookies()).delete(OWNER_COOKIE);
  return ok({ owner: false });
}
