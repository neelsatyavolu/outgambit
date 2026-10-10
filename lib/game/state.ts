import { remainingMs } from "../chess/clock";
import { finishGame, getGame, listMoves } from "../db/games";
import { poolOf } from "../rating/elo";
import { settleRatings } from "../rating/settle";
import { runAiTurn } from "./ai-turn";
import type { Deps } from "./deps";
import { opposite, turnAt, type Game, type GameView } from "./types";

export type Viewer = { playerId?: string; owner: boolean };

const canSee = (game: Game, viewer: Viewer): boolean =>
  viewer.owner || (viewer.playerId !== undefined && viewer.playerId === game.playerId);

/**
 * Every poll doubles as the game's heartbeat: it ends a game whose mover has
 * run out of time, and restarts an AI turn that nobody is running.
 */
async function keepAlive(deps: Deps, game: Game, now: number): Promise<Game> {
  if (game.status !== "active") return game;
  const mover = turnAt(game.ply);
  if (remainingMs(game, mover, now) <= 0) {
    const ending = { status: "finished", result: opposite(mover), reason: "timeout" } as const;
    const flagged = mover === "white" ? { whiteMs: 0 } : { blackMs: 0 };
    // Guarded by ply: a move may have been committed since this poll read the game.
    await finishGame(deps.db, game.id, ending, { expectedPly: game.ply, ...flagged });
    return (await getGame(deps.db, game.id)) ?? game;
  }
  const aiToMove = mover !== game.playerColor;
  const unattended = game.aiLeaseUntil === null || game.aiLeaseUntil <= now;
  if (aiToMove && unattended) deps.schedule(() => runAiTurn(deps, game.id));
  return game;
}

/** Applies a just-finished game to the ratings, so the view can show what it changed. */
async function rated(deps: Deps, game: Game): Promise<Game> {
  if (game.status !== "finished" || game.rated) return game;
  await settleRatings(deps.db);
  return (await getGame(deps.db, game.id)) ?? game;
}

/** The game as a browser may see it, or null if this viewer may not. */
export async function getGameView(deps: Deps, gameId: string, viewer: Viewer): Promise<GameView | null> {
  const found = await getGame(deps.db, gameId);
  if (!found || !canSee(found, viewer)) return null;
  const now = deps.now();
  const game = await rated(deps, await keepAlive(deps, found, now));
  return {
    id: game.id,
    status: game.status,
    result: game.result,
    reason: game.reason,
    playerColor: game.playerColor,
    provider: game.provider,
    modelLabel: game.modelLabel,
    effort: game.effort,
    timeControl: game.timeControl,
    fen: game.fen,
    turn: turnAt(game.ply),
    moves: await listMoves(deps.db, game.id),
    whiteMs: Math.max(0, remainingMs(game, "white", now)),
    blackMs: Math.max(0, remainingMs(game, "black", now)),
    serverNow: now,
    createdAt: game.createdAt,
    pool: poolOf(game.timeControl),
    rating: game.rating,
  };
}
