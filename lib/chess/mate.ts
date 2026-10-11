import type { Chess } from "chess.js";

/**
 * A search for checkmates that can be forced: whatever the other side
 * replies, the mate still comes. The models that pick a move from a list
 * cannot work this out, so code does, and plays what it finds.
 */
export type MateLimits = {
  /** The longest mate looked for, counted in moves by the side to move. */
  moves: number;
  /** The most positions one search may look at. Past that it gives up, having found nothing. */
  positions: number;
  /**
   * Whether quiet moves are tried on the way to the mate. Otherwise every
   * move but the mate itself must be a check, which is most of what there is
   * to find in a crowded position and costs almost nothing where there are no
   * checks to give.
   */
  wide: boolean;
};

/** For any position: it runs on every turn, so it follows checks only. */
export const MATE_LIMITS: MateLimits = { moves: 3, positions: 1_500, wide: false };

/**
 * For a bare king being hunted down, where the mates begin with quiet moves
 * and the lone king has few replies to try. The search is the slow part of
 * such a turn. In the benchmark in smoke/endgames.smoke.ts this size took 44
 * ms a turn and won 109 games of 112; 600 positions took 92 ms and won the
 * same 109.
 */
export const HUNT_LIMITS: MateLimits = { moves: 3, positions: 250, wide: true };

type Search = { left: number; wide: boolean };

const isCheck = (san: string): boolean => san.endsWith("+");
const isMate = (san: string): boolean => san.endsWith("#");

/** Whether the side to move can force mate within `moves` of its own moves. */
function canMate(chess: Chess, moves: number, search: Search): boolean {
  search.left -= 1;
  const sans = chess.moves();
  if (sans.some(isMate)) return true;
  if (moves === 1 || search.left <= 0) return false;
  // Checks first: most forced mates begin with one, and a check leaves few replies to look at.
  const ordered = [...sans.filter(isCheck), ...sans.filter((san) => !isCheck(san))];
  return ordered.some((san) => forces(chess, san, moves, search));
}

/** Whether playing `san` leaves no reply that escapes mate within `moves - 1` more moves. */
function forces(chess: Chess, san: string, moves: number, search: Search): boolean {
  if (search.left <= 0) return false;
  if (!search.wide && !isCheck(san)) return false;
  search.left -= 1;
  chess.move(san);
  const replies = chess.moves();
  // No reply at all is stalemate: a move that mates was caught by its "#" before it got here.
  let forced = replies.length > 0;
  for (let i = 0; forced && i < replies.length; i++) {
    chess.move(replies[i]);
    forced = canMate(chess, moves - 1, search);
    chess.undo();
  }
  // A move that ends the game as a draw forces nothing. Asked last, since it is rarely reached and slow to answer.
  forced &&= !chess.isDraw();
  chess.undo();
  // A search that ran out of positions has proved nothing.
  return forced && search.left > 0;
}

/**
 * The first moves (SAN) of the quickest checkmate the side to move can
 * force, or none if it cannot force one within the limits. Every move given
 * is proved: none is a guess. Leaves the board as it found it.
 */
export function forcedMates(chess: Chess, limits: MateLimits = MATE_LIMITS): string[] {
  const sans = chess.moves();
  const direct = sans.filter(isMate);
  if (direct.length > 0) return direct;
  const search: Search = { left: limits.positions, wide: limits.wide };
  for (let moves = 2; moves <= limits.moves && search.left > 0; moves++) {
    const found = sans.filter((san) => forces(chess, san, moves, search));
    if (found.length > 0) return found;
  }
  return [];
}
