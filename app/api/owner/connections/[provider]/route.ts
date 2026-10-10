import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { deleteConnection } from "@/lib/db/connections";
import type { Provider } from "@/lib/game/types";
import { fail, ok, readBody } from "@/lib/http";
import { connectionKind, saveApiKey } from "@/lib/owner/admin";
import { refuseUnlessOwner } from "@/lib/server/context";

const schema = z.object({ apiKey: z.string().trim().min(8).max(500) });
type Context = { params: Promise<{ provider: string }> };

export async function PUT(request: Request, { params }: Context) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const { provider } = await params;
  if (connectionKind(provider) !== "key") return fail("This provider does not take an API key.", 400);
  const body = await readBody(request, schema);
  if (!body) return fail("Paste the API key.", 400);
  await saveApiKey(await getDb(), provider as Provider, body.apiKey, Date.now());
  return ok({ connected: true });
}

export async function DELETE(request: Request, { params }: Context) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const { provider } = await params;
  if (!connectionKind(provider)) return fail("Unknown provider.", 404);
  await deleteConnection(await getDb(), provider as Provider);
  return ok({ connected: false });
}
