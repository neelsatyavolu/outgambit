import "server-only";
import { ARENA } from "../config";
import { activeArenaGame, countArenaForDay } from "../db/arena";
import type { Queryable } from "../db/client";
import { dayKey } from "../game/limits";
import type { Provider } from "../game/types";
import { CONNECTABLE } from "../owner/admin";
import { isOffered, listForOwner } from "../owner/catalog";
import { arenaGamesPerDay, sittingOut } from "./run";
import { cronSecret } from "./schedule";

export type ArenaStatus = {
  gamesPerDay: number;
  maxGamesPerDay: number;
  /** Games started today that count toward the budget. */
  startedToday: number;
  liveGameId: string | null;
  /** Whether games start by themselves. False when the schedule's secret is not set. */
  scheduled: boolean;
  /** Every model on offer to players, and whether it also plays in the arena. */
  models: Array<{
    provider: Provider;
    id: string;
    label: string;
    arena: boolean;
    note: string;
    /** Why the model is out of the arena for the rest of today. Null while it may play. */
    sittingOut: string | null;
  }>;
};

/** What the owner sees of the arena: its budget, today's count and who takes part. */
export async function arenaStatus(q: Queryable, now: number): Promise<ArenaStatus> {
  const day = dayKey(now);
  const [gamesPerDay, startedToday, live, models, out] = await Promise.all([
    arenaGamesPerDay(q),
    countArenaForDay(q, day),
    activeArenaGame(q),
    listForOwner(q),
    sittingOut(q, day),
  ]);
  const stopped = (m: { provider: Provider; id: string }): string | null => {
    const found = out.find((o) => o.provider === m.provider && o.model === m.id);
    return found ? (found.why ?? "could not be reached") : null;
  };
  return {
    gamesPerDay,
    maxGamesPerDay: ARENA.maxGamesPerDay,
    startedToday,
    liveGameId: live?.id ?? null,
    scheduled: cronSecret() !== undefined,
    models: models.filter(isOffered).map((m) => ({
      provider: m.provider,
      id: m.id,
      label: m.label,
      arena: m.arena,
      note: CONNECTABLE.find((c) => c.provider === m.provider)?.note ?? "",
      sittingOut: stopped(m),
    })),
  };
}
