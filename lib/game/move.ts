import { chargeMove } from "../chess/clock";
import { applyMove } from "../chess/rules";
import { commitMove, finishGame, getGame, listMoves } from "../db/games";
import { startAiTurn } from "./ai-turn";
import type { Deps } from "./deps";
import { opposite, turnAt } from "./types";

export type MoveError = "not_found" | "not_active" | "not_your_turn" | "stale" | "illegal_move" | "out_of_time";
export type MoveOutcome = { ok: true } | { ok: false; error: MoveError };

const refuse = (error: MoveError): MoveOutcome => ({ ok: false, error });

/**
 * Plays the player's move (UCI). `seenPly` is the ply the player was looking
 * at, so a repeated or late request is refused instead of played twice.
 */
export async function playerMove(
  deps: Deps,
  gameId: string,
  playerId: string,
  move: string,
  seenPly: number,
): Promise<MoveOutcome> {
  const game = await getGame(deps.db, gameId);
  if (!game || game.playerId !== playerId) return refuse("not_found");
  if (game.status !== "active") return refuse("not_active");
  if (game.ply !== seenPly) return refuse("stale");
  if (turnAt(game.ply) !== game.playerColor) return refuse("not_your_turn");

  const now = deps.now();
  const isWhite = game.playerColor === "white";
  const charge = chargeMove(isWhite ? game.whiteMs : game.blackMs, game.turnStartedAt, now, game.incrementMs);
  if (charge.flagged) {
    const ending = { status: "finished", result: opposite(game.playerColor), reason: "timeout" } as const;
    await finishGame(deps.db, game.id, ending, { expectedPly: game.ply, ...(isWhite ? { whiteMs: 0 } : { blackMs: 0 }) });
    return refuse("out_of_time");
  }

  const history = (await listMoves(deps.db, game.id)).map((m) => m.san);
  const applied = applyMove(history, move);
  if (!applied) return refuse("illegal_move");

  const committed = await commitMove(deps.db, {
    gameId: game.id,
    expectedPly: game.ply,
    move: { san: applied.san, uci: applied.uci, fenAfter: applied.fen, spentMs: charge.spentMs },
    whiteMs: isWhite ? charge.nextMs : game.whiteMs,
    blackMs: isWhite ? game.blackMs : charge.nextMs,
    now,
    ...(applied.outcome ? { finish: { status: "finished" as const, ...applied.outcome } } : {}),
  });
  if (!committed) return refuse("stale");
  if (!applied.outcome) await startAiTurn(deps, game);
  return { ok: true };
}

/** The player gives up. False if the game is not theirs or is already over. */
export async function resign(deps: Deps, gameId: string, playerId: string): Promise<boolean> {
  const game = await getGame(deps.db, gameId);
  if (!game || game.playerId !== playerId) return false;
  return finishGame(deps.db, game.id, {
    status: "finished",
    result: opposite(game.playerColor),
    reason: "resignation",
  });
}
