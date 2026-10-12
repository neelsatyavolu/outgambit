import { chargeMove, remainingMs } from "../chess/clock";
import { applyMove } from "../chess/rules";
import type { Queryable } from "../db/client";
import { commitMove, finishGame, getGame, getGameSnapshot } from "../db/games";
import { startAiTurn } from "./ai-turn";
import type { Deps } from "./deps";
import { opposite, turnAt, type Game } from "./types";

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
  playerId: string | ((tx: Queryable) => Promise<string | undefined>),
  move: string,
  seenPly: number,
  arrivedAt: number = deps.now(),
): Promise<MoveOutcome> {
  let next: { game: Game; history: string[] } | undefined;
  const outcome = await deps.db.transaction(async (tx): Promise<MoveOutcome> => {
    // Lock before identity validation: a timeout poll must wait for a move
    // that reached us before the deadline to finish checking and committing.
    const snapshot = await getGameSnapshot(tx, gameId, true);
    if (!snapshot) return refuse("not_found");
    const { game, moves } = snapshot;
    const player = typeof playerId === "string" ? playerId : await playerId(tx);
    if (game.playerId !== player) return refuse("not_found");
    if (game.status !== "active") return refuse("not_active");
    if (game.ply !== seenPly || moves.length !== game.ply) return refuse("stale");
    if (turnAt(game.ply) !== game.playerColor) return refuse("not_your_turn");

    const isWhite = game.playerColor === "white";
    const charge = chargeMove(isWhite ? game.whiteMs : game.blackMs, game.turnStartedAt, arrivedAt, game.incrementMs);
    if (charge.flagged) {
      const ending = { status: "finished", result: opposite(game.playerColor), reason: "timeout" } as const;
      await finishGame(tx, game.id, ending, { expectedPly: game.ply, ...(isWhite ? { whiteMs: 0 } : { blackMs: 0 }) });
      return refuse("out_of_time");
    }

    const history = moves.map((m) => m.san);
    const applied = applyMove(history, move);
    if (!applied) return refuse("illegal_move");

    const now = deps.now();
    const whiteMs = isWhite ? charge.nextMs : game.whiteMs;
    const blackMs = isWhite ? game.blackMs : charge.nextMs;
    const committed = await commitMove(tx, {
      gameId: game.id,
      expectedPly: game.ply,
      move: { san: applied.san, uci: applied.uci, fenAfter: applied.fen, spentMs: charge.spentMs },
      whiteMs,
      blackMs,
      now,
      ...(applied.outcome ? { finish: { status: "finished" as const, ...applied.outcome } } : {}),
    });
    if (!committed) return refuse("stale");
    if (!applied.outcome) {
      next = {
        game: { ...game, fen: applied.fen, ply: game.ply + 1, whiteMs, blackMs, turnStartedAt: now, aiLeaseUntil: null },
        history: [...history, applied.san],
      };
    }
    return { ok: true };
  });
  // AI work may read the database too; release the row and connection first.
  if (next) await startAiTurn(deps, next.game, next.history);
  return outcome;
}

/** The player gives up. False if the game is not theirs or is already over. */
export async function resign(deps: Deps, gameId: string, playerId: string): Promise<boolean> {
  const game = await getGame(deps.db, gameId);
  if (!game || game.playerId !== playerId) return false;
  const now = deps.now();
  const mover = turnAt(game.ply);
  const timedOut = remainingMs(game, mover, now) <= 0;
  return finishGame(deps.db, game.id, {
    status: "finished",
    result: opposite(timedOut ? mover : game.playerColor),
    reason: timedOut ? "timeout" : "resignation",
  }, {
    expectedPly: game.ply,
    whiteMs: Math.max(0, remainingMs(game, "white", now)),
    blackMs: Math.max(0, remainingMs(game, "black", now)),
  });
}
