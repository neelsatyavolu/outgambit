import type { Color, GameView } from "../game/types";

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

/**
 * Clocks for the moment a move is sent. The side that just moved is frozen at
 * the time it has left, and the other side starts running from `now`.
 */
export function handClock(
  view: Pick<GameView, "status" | "turn" | "whiteMs" | "blackMs">,
  at: number,
  now: number,
): { whiteMs: number; blackMs: number; at: number; turn: Color } {
  const spent = view.status === "active" ? Math.max(0, now - at) : 0;
  const whiteMs = view.turn === "white" ? Math.max(0, view.whiteMs - spent) : view.whiteMs;
  const blackMs = view.turn === "black" ? Math.max(0, view.blackMs - spent) : view.blackMs;
  return { whiteMs, blackMs, at: now, turn: view.turn === "white" ? "black" : "white" };
}

/** Only timestamps determine elapsed time; delayed frames never accumulate clock drift. */
export function clockMs(ms: number, running: boolean, at: number, now: number): number {
  return running ? Math.max(0, ms - Math.max(0, now - at)) : ms;
}
