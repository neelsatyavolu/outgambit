import { turnAt, type Color, type Game } from "../game/types";

type ClockState = Pick<Game, "whiteMs" | "blackMs" | "turnStartedAt" | "ply" | "status">;

/**
 * Time left for `color` at `now`. Only the side to move in an active game is
 * running. The value goes negative once that side has run out.
 */
export function remainingMs(game: ClockState, color: Color, now: number): number {
  const stored = color === "white" ? game.whiteMs : game.blackMs;
  const running = game.status === "active" && turnAt(game.ply) === color;
  return running ? stored - Math.max(0, now - game.turnStartedAt) : stored;
}

export type Charge = { flagged: boolean; nextMs: number; spentMs: number };

/** Charges the mover for the time since their turn began. */
export function chargeMove(clockMs: number, turnStartedAt: number, now: number, incrementMs: number): Charge {
  const spentMs = Math.max(0, now - turnStartedAt);
  const left = clockMs - spentMs;
  const flagged = left <= 0;
  return { flagged, nextMs: flagged ? 0 : left + incrementMs, spentMs };
}
