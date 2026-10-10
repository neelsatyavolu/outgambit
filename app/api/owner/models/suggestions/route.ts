import { getDb } from "@/lib/db/client";
import { ok } from "@/lib/http";
import { suggestedFreeModels } from "@/lib/owner/admin";
import { refuseUnlessOwner } from "@/lib/server/context";

export async function GET(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  return ok(await suggestedFreeModels(await getDb()));
}
