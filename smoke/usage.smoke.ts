import { describe, expect, it } from "vitest";
import { usageSource } from "@/lib/budget/sources";
import { getDb } from "@/lib/db/client";
import { listConnections } from "@/lib/db/connections";

// Reads each provider's own usage figures with the credentials stored through
// the owner panel, to check that it still answers in the shape lib/budget
// expects. Reading them spends nothing.
describe("usage readings", async () => {
  const db = await getDb();
  const connected = new Set((await listConnections(db)).map((c) => c.provider));
  const usage = usageSource(db);

  it.each(["codex", "grok"] as const)("reads the %s subscription's meter", async (provider) => {
    if (!connected.has(provider)) return;
    const reading = await usage.meter(provider, Date.now());
    // Reported so the run shows the real figures beside the pace Gambit holds them to.
    process.stdout.write(`\nUSAGE ${provider} ${JSON.stringify(reading)}\n`);
    expect(reading.error).toBeNull();
    expect(reading.value?.weekly.usedPercent).toBeGreaterThanOrEqual(0);
    expect(reading.value?.weekly.resetsAt).toBeGreaterThan(Date.now());
  });

  it("reads OpenRouter's free limit", async () => {
    if (!connected.has("openrouter")) return;
    const cap = await usage.openRouterCap(Date.now());
    process.stdout.write(`\nUSAGE openrouter ${cap} requests a day\n`);
    expect([50, 1000]).toContain(cap);
  });
});
