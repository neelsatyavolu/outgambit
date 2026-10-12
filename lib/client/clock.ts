import type { GameView } from "../game/types";

export type ClockSync = { offsetMs: number; networkMs: number };

/** Map server epoch time onto performance.now(), using the least delayed response. */
export function syncClock(
  previous: ClockSync | null,
  view: Pick<GameView, "serverNow" | "serverReceivedAt">,
  sentAt: number,
  receivedAt: number,
): ClockSync {
  const serverMs = view.serverReceivedAt === undefined ? 0 : Math.max(0, view.serverNow - view.serverReceivedAt);
  const networkMs = Math.max(0, receivedAt - sentAt - serverMs);
  const sample = { offsetMs: view.serverNow + networkMs / 2 - receivedAt, networkMs };
  // A sample's offset lies within half its network round trip. Disjoint bounds
  // mean the old mapping no longer fits, for example after device suspension.
  const compatible = previous && Math.abs(previous.offsetMs - sample.offsetMs) <= (previous.networkMs + networkMs) / 2 + 1;
  return compatible && previous.networkMs <= networkMs ? previous : sample;
}

/** Only timestamps determine elapsed time; delayed frames never accumulate clock drift. */
export function clockMs(ms: number, running: boolean, at: number, now: number): number {
  return running ? Math.max(0, ms - Math.max(0, now - at)) : ms;
}
