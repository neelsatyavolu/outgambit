import { remainingMs } from "../chess/clock";
import { finishGame, getGame, listMoves } from "../db/games";
import { poolOf } from "../rating/elo";
import { settleRatings } from "../rating/settle";
import { runAiTurn } from "./ai-turn";
import type { Deps } from "./deps";
import { opposite, turnAt, type Game, type GameView } from "./types";

export type Viewer = { playerId?: string; owner: boolean };

// Arena games have no player to keep them private for, so anyone may watch.
const canSee = (game: Game, viewer: Viewer): boolean =>
  game.rival !== null || viewer.owner || (viewer.playerId !== undefined && viewer.playerId === game.playerId);

/**
 * Every poll doubles as the game's heartbeat: it ends a game whose mover has
 * run out of time, and restarts an AI turn that nobody is running.
 */
async function keepAlive(deps: Deps, game: Game, now: number): Promise<Game> {
  // An arena game is run by the arena's own schedule, never by whoever is watching.
  if (game.status !== "active" || game.rival) return game;
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
  // An arena game's clocks stand still between runs, when no model is being asked.
  const clockAt = game.rival && (game.aiLeaseUntil ?? 0) <= now ? game.turnStartedAt : now;
  return {
    id: game.id,
    status: game.status,
    result: game.result,
    reason: game.reason,
    playerColor: game.playerColor,
    provider: game.provider,
    modelLabel: game.modelLabel,
    effort: game.effort,
    rival: game.rival && { label: game.rival.modelLabel, effort: game.rival.effort },
    aiError: game.aiError,
    timeControl: game.timeControl,
    fen: game.fen,
    turn: turnAt(game.ply),
    moves: await listMoves(deps.db, game.id),
    whiteMs: Math.max(0, remainingMs(game, "white", clockAt)),
    blackMs: Math.max(0, remainingMs(game, "black", clockAt)),
    serverNow: now,
    createdAt: game.createdAt,
    pool: poolOf(game.timeControl),
    rating: game.rating,
  };
}
