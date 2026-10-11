import { describe, expect, it } from "vitest";
import { getAdapter } from "@/lib/ai/registry";
import { replay } from "@/lib/chess/rules";
import { LLM_CALL_TIMEOUT_MS } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import type { Effort } from "@/lib/game/types";
import { listOffered } from "@/lib/owner/catalog";

// Times every offered model that has effort levels, at each effort, on a few
// positions, and counts how often it finds the move the position calls for.
// The time controls and the efforts on offer rest on these numbers. Run with
// EFFORT_BENCH=1; EFFORT_BENCH_ONLY=codex,grok narrows it to some providers.
// A dozen calls per model, on the owner's quota.
const LEVELS: Effort[] = ["low", "medium", "high"];
const only = (process.env.EFFORT_BENCH_ONLY ?? "").split(",").filter(Boolean);

type Probe = { name: string; history: string[]; best?: string };

const PROBES: Probe[] = [
  { name: "opening", history: [] },
  { name: "mate in one", history: ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"], best: "Qxf7#" },
  { name: "free queen", history: ["e4", "e5", "Nf3", "Qh4"], best: "Nxh4" },
  {
    name: "middlegame",
    history: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O"],
  },
];

/** `found` is null where the position has no one right move, or the model gave no legal move. */
type Line = {
  model: string; effort: Effort; probe: string; seconds: number; reply: string; legal: boolean; found: boolean | null;
};

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe.runIf(process.env.EFFORT_BENCH === "1")("time per move at each effort", async () => {
  const db = await getDb();
  const models = (await listOffered(db)).filter(
    (m) => m.supportsEffort && (only.length === 0 || only.includes(m.provider)),
  );

  it("has a model with effort levels to time", () => {
    expect(models.length, "connect a provider and enable a model in /owner first").toBeGreaterThan(0);
  });

  it.concurrent.each(models.map((m) => [`${m.provider}/${m.id}`, m] as const))(
    "%s",
    async (name, model) => {
      const adapter = await getAdapter(db, model.provider, Date.now());
      const lines: Line[] = [];
      for (const effort of LEVELS) {
        for (const probe of PROBES) {
          const position = replay(probe.history);
          const started = Date.now();
          const result = await adapter!({
            fen: position.fen,
            history: probe.history,
            legalMoves: position.legal,
            color: position.turn,
            remainingMs: 1_200_000,
            model: model.id,
            effort,
            signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
          });
          lines.push({
            model: name,
            effort,
            probe: probe.name,
            seconds: (Date.now() - started) / 1000,
            reply: result.kind === "move" ? result.san : result.kind === "invalid" ? `illegal: ${result.raw}` : result.message,
            legal: result.kind === "move",
            found: probe.best === undefined || result.kind !== "move" ? null : result.san === probe.best,
          });
        }
      }
      console.table(lines.map((line) => ({ ...line, seconds: line.seconds.toFixed(1) })));
      console.table(
        LEVELS.map((effort) => {
          const at = lines.filter((line) => line.effort === effort);
          return {
            model: name,
            effort,
            median: median(at.map((line) => line.seconds)).toFixed(1),
            slowest: Math.max(...at.map((line) => line.seconds)).toFixed(1),
            tactics: `${at.filter((line) => line.found).length}/${PROBES.filter((p) => p.best).length}`,
            legal: `${at.filter((line) => line.legal).length}/${at.length}`,
          };
        }),
      );
      expect(lines).toHaveLength(LEVELS.length * PROBES.length);
    },
    LEVELS.length * PROBES.length * LLM_CALL_TIMEOUT_MS,
  );
});
