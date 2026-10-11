import { usageReport } from "@/lib/budget/report";
import { usageSource } from "@/lib/budget/sources";
import { getDb } from "@/lib/db/client";
import { ok } from "@/lib/http";
import { listOffered } from "@/lib/owner/catalog";
import { refuseUnlessOwner } from "@/lib/server/context";

export async function GET(request: Request) {
  const refusal = await refuseUnlessOwner(request);
  if (refusal) return refusal;
  const db = await getDb();
  return ok(await usageReport(db, usageSource(db), await listOffered(db), Date.now()));
}
