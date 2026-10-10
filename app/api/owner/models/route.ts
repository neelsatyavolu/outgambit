import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { PROVIDERS } from "@/lib/game/types";
import { fail, ok, readBody } from "@/lib/http";
import { addCustomModel, removeCustomModel, setModelEnabled } from "@/lib/owner/admin";
import { listForOwner } from "@/lib/owner/catalog";
import { refuseUnlessOwner } from "@/lib/server/context";

const key = { provider: z.enum(PROVIDERS), id: z.string().trim().min(1).max(200) };
const addSchema = z.object({ ...key, label: z.string().trim().min(1).max(80), supportsEffort: z.boolean() });
const toggleSchema = z.object({ ...key, enabled: z.boolean() });
const removeSchema = z.object(key);

export async function GET(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  return ok(await listForOwner(await getDb()));
}

export async function POST(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const body = await readBody(request, addSchema);
  if (!body) return fail("Give the model an ID and a label.", 400);
  const added = await addCustomModel(await getDb(), body);
  return added.ok ? ok({ added: true }, 201) : fail(added.error, 400);
}

export async function PATCH(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const body = await readBody(request, toggleSchema);
  if (!body) return fail("Bad request.", 400);
  const changed = await setModelEnabled(await getDb(), body.provider, body.id, body.enabled);
  return changed ? ok({ enabled: body.enabled }) : fail("Unknown model.", 404);
}

export async function DELETE(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const body = await readBody(request, removeSchema);
  if (!body) return fail("Bad request.", 400);
  const removed = await removeCustomModel(await getDb(), body.provider, body.id);
  return removed ? ok({ removed: true }) : fail("Only models you added can be removed.", 400);
}
