import type { GameView } from "../game/types";

/**
 * Whether a view from the server is older than the one already on screen.
 * Polls and move requests can answer out of order; a late answer must not
 * take a move back off the board or revive a finished game.
 */
export function isStale(current: GameView | null, incoming: GameView): boolean {
  if (!current) return false;
  if (incoming.moves.length < current.moves.length) return true;
  return current.status !== "active" && incoming.status === "active";
}

/** The position to draw: the one after `shown` moves, or the live one. */
export function shownFen(view: GameView, shown: number | null, startFen: string): string {
  if (shown === null || shown >= view.moves.length || shown < 0) return view.fen;
  return shown === 0 ? startFen : view.moves[shown - 1].fenAfter;
}
