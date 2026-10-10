import { describe, expect, it } from "vitest";
import { getAdapter } from "@/lib/ai/registry";
import { replay } from "@/lib/chess/rules";
import { getDb } from "@/lib/db/client";
import { listOffered } from "@/lib/owner/catalog";

// Asks every model currently offered to players for an opening move, using
// the credentials stored through the owner panel. Each call spends real quota.
describe("offered models", async () => {
  const db = await getDb();
  const offered = (await listOffered(db)).filter((m) => m.provider !== "fake");
  const start = replay([]);

  it("has at least one real model to check", () => {
    expect(offered.length, "connect a provider and enable a model in /owner first").toBeGreaterThan(0);
  });

  it.each(offered.map((m) => [`${m.provider}/${m.id}`, m] as const))("%s returns a legal first move", async (_name, model) => {
    const adapter = await getAdapter(db, model.provider, Date.now());
    const result = await adapter!({
      fen: start.fen,
      history: [],
      legalMoves: start.legal,
      color: "white",
      remainingMs: 600_000,
      model: model.id,
      ...(model.supportsEffort ? { effort: "low" as const } : {}),
      signal: AbortSignal.timeout(240_000),
    });
    expect(result).toMatchObject({ kind: "move" });
  });
});
