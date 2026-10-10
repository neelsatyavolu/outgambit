import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fail, ok, readBody } from "@/lib/http";
import { connectionKind } from "@/lib/owner/admin";
import type { OAuthProvider } from "@/lib/owner/credentials";
import { PENDING_TTL_MS, finishOAuth, startOAuth } from "@/lib/owner/oauth";
import { refuseUnlessOwner, secureCookies } from "@/lib/server/context";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("finish"), pasted: z.string().max(4000) }),
]);

const pendingCookie = (provider: string): string => `gambit_oauth_${provider}`;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const { provider } = await params;
  if (connectionKind(provider) !== "oauth") return fail("This provider does not use sign-in.", 400);
  const body = await readBody(request, schema);
  if (!body) return fail("Bad request.", 400);
  const jar = await cookies();
  const name = pendingCookie(provider);
  const now = Date.now();

  if (body.action === "start") {
    const { url, pending } = startOAuth(provider as OAuthProvider, now);
    jar.set(name, pending, {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookies(),
      path: "/api/owner",
      maxAge: PENDING_TTL_MS / 1000,
    });
    return ok({ url });
  }

  const result = await finishOAuth(await getDb(), provider as OAuthProvider, body.pasted, jar.get(name)?.value, now);
  if (!result.ok) return fail(result.error, 400);
  jar.delete({ name, path: "/api/owner" });
  return ok({ connected: true });
}
