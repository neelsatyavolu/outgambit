import { findTimeControl } from "../config";
import type { GameView } from "../game/types";

/** How often to ask after a slow game, and while it is the viewer's own turn. */
export const SLOW_POLL_MS = 1_000;
/**
 * How often to ask while a bullet or blitz opponent is to move. A queued
 * premove cannot leave until that move is known, and the viewer's clock is
 * already running, so the gap has to stay far under a second.
 */
export const FAST_POLL_MS = 100;

/**
 * Whether a view from the server is older than the one already on screen.
 * Polls and move requests can answer out of order; a late answer must not
 * take a move back off the board or revive a finished game.
 */
export function isStale(current: GameView | null, incoming: GameView): boolean {
  if (!current) return false;
  if (incoming.moves.length < current.moves.length) return true;
  if (incoming.moves.length === current.moves.length && incoming.serverNow < current.serverNow) return true;
  return current.status !== "active" && incoming.status === "active";
}

/** How long to wait between polls. Quick games ask often only while the opponent is to move. */
export function pollIntervalMs(timeControl: string | undefined, opponentToMove: boolean): number {
  if (!opponentToMove) return SLOW_POLL_MS;
  return findTimeControl(timeControl ?? "")?.fastOnly ? FAST_POLL_MS : SLOW_POLL_MS;
}

/** The position to draw: the one after `shown` moves, or the live one. */
export function shownFen(view: GameView, shown: number | null, startFen: string): string {
  if (shown === null || shown >= view.moves.length || shown < 0) return view.fen;
  return shown === 0 ? startFen : view.moves[shown - 1].fenAfter;
}
