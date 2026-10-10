import { getDb } from "@/lib/db/client";
import type { Provider } from "@/lib/game/types";
import { fail, ok } from "@/lib/http";
import { connectionKind, testConnection } from "@/lib/owner/admin";
import { refuseUnlessOwner } from "@/lib/server/context";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const { provider } = await params;
  if (!connectionKind(provider)) return fail("Unknown provider.", 404);
  const result = await testConnection(await getDb(), provider as Provider, Date.now());
  return result.ok ? ok({ working: true }) : fail(result.error, 400);
}
