import { describe, expect, it } from "vitest";
import { JEV_MODEL } from "@/lib/ai/jev";
import { MERCURY_MODEL } from "@/lib/ai/mercury";
import { OPENAI_DECISIONS_MODEL } from "@/lib/ai/openai-decisions";
import { getAdapter } from "@/lib/ai/registry";
import { SUBQ_MODEL } from "@/lib/ai/subq";
import type { Adapter } from "@/lib/ai/types";
import { focusMoves, isForcingNote, noteScore, survey } from "@/lib/chess/notes";
import { replay } from "@/lib/chess/rules";
import { assessMoves, shortlist } from "@/lib/chess/tactics";
import { centsPerMillionTokens } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import type { Provider } from "@/lib/game/types";
import { listForOwner } from "@/lib/owner/catalog";

// One call per position per connected decision model, including ones switched
// off for visitors. The positions are openings the notes do not already settle,
// so a hit is the model's, and a miss costs a real call. Run with DECISION_BENCH=1.
// Four calls a model. A forcing note this far ahead is played locally, as in the adapter.
const OBVIOUS_MARGIN = 8;

type Probe = { name: string; history: string[]; best: readonly string[] };

const PROBES: readonly Probe[] = [
  { name: "Sicilian", history: ["e4", "c5", "Nf3"], best: ["Nc6", "Nf6"] },
  { name: "Two knights", history: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"], best: ["Ng5"] },
  { name: "Italian", history: ["e4", "e5", "Bc4", "Nc6"], best: ["Nf3", "Nc3"] },
  { name: "Giuoco", history: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"], best: ["O-O", "Nc3"] },
];

const MODELS: readonly { provider: Provider; id: string }[] = [
  { provider: "jev", id: JEV_MODEL },
  { provider: "mercury", id: MERCURY_MODEL },
  { provider: "subq", id: SUBQ_MODEL },
  { provider: "openai", id: OPENAI_DECISIONS_MODEL },
  { provider: "gateway", id: "liquid/d1" },
  { provider: "gateway", id: "microsoft/microsoft-decision-1" },
];

type Line = {
  model: string;
  probe: string;
  reply: string;
  hit: boolean;
  legal: boolean;
  ms: number;
  tokens: number | null;
};

/** Moves the adapter would send, and whether it would ask at all. */
function offered(history: readonly string[], rng: () => number): { sans: string[]; asks: boolean } {
  const tactical = shortlist(assessMoves(history)).map((row) => row.move);
  const view = survey(history, tactical.map((move) => move.uci));
  const moves = focusMoves(view, tactical, rng);
  const ranked = moves
    .map((move) => {
      const notes = view.notes.get(move.uci) ?? [];
      return { san: move.san, score: noteScore(notes, view.lead), forcing: notes.some(isForcingNote) };
    })
    .sort((a, b) => b.score - a.score || (a.san < b.san ? -1 : 1));
  const [top, second] = ranked;
  const obvious = Boolean(top?.forcing && second && top.score - second.score >= OBVIOUS_MARGIN);
  return { sans: ranked.map((row) => row.san), asks: moves.length > 1 && !obvious };
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

describe.runIf(process.env.DECISION_BENCH === "1")("decision models, cost per sound move", async () => {
  const db = await getDb();
  const owner = await listForOwner(db);
  const models = MODELS.filter((model) =>
    owner.some((row) => row.provider === model.provider && row.id === model.id && row.connected),
  );
  const skipped = MODELS.filter((model) => !models.includes(model)).map((model) => `${model.provider}/${model.id}`);

  it("asks each connected model four opening moves and prices the replies", async () => {
    console.log(skipped.length > 0 ? `not connected: ${skipped.join(", ")}` : "every decision model is connected");
    expect(models.length, "connect a decision provider in /owner first").toBeGreaterThan(0);
    for (const probe of PROBES) {
      for (const rng of [() => 0, () => 0.5, () => 0.99]) {
        const choices = offered(probe.history, rng);
        expect(choices.asks, probe.name).toBe(true);
        expect(choices.sans.some((san) => (probe.best as readonly string[]).includes(san)), probe.name).toBe(true);
      }
    }

    const adapters = new Map<Provider, Promise<Adapter | null>>();
    const adapterFor = (provider: Provider): Promise<Adapter | null> => {
      const pending = adapters.get(provider) ?? getAdapter(db, provider, Date.now());
      adapters.set(provider, pending);
      return pending;
    };

    const lines: Line[] = await Promise.all(
      models.flatMap((model) =>
        PROBES.map(async (probe) => {
          const name = `${model.provider}/${model.id}`;
          const position = replay(probe.history);
          const started = Date.now();
          try {
            const adapter = await adapterFor(model.provider);
            if (!adapter) {
              return { model: name, probe: probe.name, reply: "no adapter", hit: false, legal: false, ms: Date.now() - started, tokens: null };
            }
            const result = await adapter({
              fen: position.fen,
              history: [...probe.history],
              legalMoves: position.legal,
              color: position.turn,
              remainingMs: 60_000,
              model: model.id,
              signal: AbortSignal.timeout(12_000),
            });
            const reply = result.kind === "move" ? result.san : result.kind === "invalid" ? `illegal: ${result.raw}` : result.message;
            return {
              model: name,
              probe: probe.name,
              reply,
              hit: result.kind === "move" && probe.best.includes(result.san),
              legal: result.kind === "move",
              ms: Date.now() - started,
              tokens: result.inputTokens ?? null,
            };
          } catch (error) {
            return {
              model: name,
              probe: probe.name,
              reply: error instanceof Error ? error.name : "Error",
              hit: false,
              legal: false,
              ms: Date.now() - started,
              tokens: null,
            };
          }
        }),
      ),
    );

    const summary = models.map((model) => {
      const name = `${model.provider}/${model.id}`;
      const rows = lines.filter((line) => line.model === name);
      const hits = rows.filter((line) => line.hit).length;
      const tokens = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
      const unbilled = rows.some((row) => row.legal && row.tokens == null);
      const price = centsPerMillionTokens(model.provider, model.id);
      const cents = unbilled ? null : (tokens / 1_000_000) * price;
      return {
        model: name,
        hits: `${hits}/${rows.length}`,
        legal: `${rows.filter((row) => row.legal).length}/${rows.length}`,
        ms: median(rows.map((row) => row.ms)),
        tokens,
        cents: cents === null ? "unbilled" : cents.toFixed(4),
        centsPerHit: cents === null || hits === 0 ? "" : (cents / hits).toFixed(4),
        price,
      };
    });
    summary.sort((a, b) => Number(b.hits[0]) - Number(a.hits[0]) || String(a.cents).localeCompare(String(b.cents)));

    console.table(lines.map((line) => ({ ...line, tokens: line.tokens ?? "" })));
    console.table(summary);
    expect(lines).toHaveLength(models.length * PROBES.length);
  });
});
