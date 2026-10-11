import { randomUUID } from "node:crypto";
import { replay } from "../chess/rules";
import { ARENA, findTimeControl } from "../config";
import { abortedArenaGames, activeArenaGame, arenaMeetings, countArenaForDay } from "../db/arena";
import type { Queryable } from "../db/client";
import { finishGame, getGame, insertGame } from "../db/games";
import { listModelRatings } from "../db/ratings";
import { getSetting, setSetting } from "../db/settings";
import { callTimeoutMs, runAiTurn } from "../game/ai-turn";
import type { Deps } from "../game/deps";
import { dayKey } from "../game/limits";
import { seatOf, turnAt, type Game } from "../game/types";
import type { OfferedModel } from "../owner/catalog";
import { POOLS, poolOf } from "../rating/elo";
import { modelKey, seedRating } from "../rating/seeds";
import { settleRatings } from "../rating/settle";
import { meetingKey, nextPairing, type Entry, type Meetings, type Pairing } from "./pairing";

/** Arena games belong to no visitor, so they are filed under this name. */
export const ARENA_PLAYER = "arena";
// One lock for starting arena games, so two runs cannot both start one.
const ARENA_LOCK = 7426002;
const GAMES_PER_DAY = "arena_games_per_day";

/** How many arena games may start in a day: the owner's number, or the default. Zero is off. */
export async function arenaGamesPerDay(q: Queryable): Promise<number> {
  const stored = Number.parseInt((await getSetting(q, GAMES_PER_DAY)) ?? "", 10);
  return Number.isInteger(stored) ? Math.min(Math.max(stored, 0), ARENA.maxGamesPerDay) : ARENA.gamesPerDay;
}

/**
 * Sets the day's budget. Zero switches the arena off there and then: the
 * live game is called off, unrated, so no further moves are asked for.
 */
export async function setArenaGamesPerDay(q: Queryable, games: number): Promise<void> {
  await setSetting(q, GAMES_PER_DAY, String(games));
  if (games > 0) return;
  const live = await activeArenaGame(q);
  if (live) await finishGame(q, live.id, { status: "aborted", result: null, reason: "called_off" });
}

/** A model that could not answer in an arena game, and what stopped it, if that was recorded. */
export type SatOut = Pick<Game, "provider" | "model"> & { why: string | null };

/**
 * The models that could not answer in an arena game on `day`: in each game
 * called off for that, the one whose turn it was.
 */
export async function sittingOut(q: Queryable, day: string): Promise<SatOut[]> {
  return (await abortedArenaGames(q, day)).flatMap((game) => {
    const seat = seatOf(game, turnAt(game.ply));
    return seat ? [{ provider: seat.provider, model: seat.model, why: game.aiError }] : [];
  });
}

/**
 * The lines that may be paired today. A model that could not answer in an
 * arena game earlier in the day sits out until tomorrow, so a provider that
 * is down or out of quota is not asked again and again.
 */
async function field(q: Queryable, models: readonly OfferedModel[], day: string): Promise<Entry[]> {
  const [ratings, out] = await Promise.all([listModelRatings(q), sittingOut(q, day)]);
  return models
    .filter((model) => !out.some((o) => o.provider === model.provider && o.model === model.id))
    .flatMap((model) => {
      const effort = model.supportsEffort ? ARENA.effort : null;
      const key = modelKey(model.provider, model.id, effort);
      const seat = { provider: model.provider, model: model.id, modelLabel: model.label, effort };
      return POOLS.filter((pool) => model.timeControls.includes(ARENA.timeControls[pool])).map((pool): Entry => {
        const earned = ratings.find((r) => r.key === key && r.pool === pool);
        const rating = earned?.rating ?? seedRating(model.provider, model.id, effort, pool);
        return { key, pool, rating, games: earned?.games ?? 0, seat };
      });
    });
}

async function meetings(q: Queryable): Promise<Meetings> {
  const met = new Map<string, number>();
  for (const { sides, timeControl, games } of await arenaMeetings(q)) {
    const [a, b] = sides.map((side) => modelKey(side.provider, side.model, side.effort));
    const key = meetingKey(a, b, poolOf(timeControl));
    met.set(key, (met.get(key) ?? 0) + games);
  }
  return met;
}

/** White takes the seat a player would have; black is the game's own model. */
function newGame({ pool, white, black }: Pairing, now: number): Game {
  const control = findTimeControl(ARENA.timeControls[pool])!;
  return {
    id: randomUUID(),
    playerId: ARENA_PLAYER,
    ipHash: ARENA_PLAYER,
    day: dayKey(now),
    ...black.seat,
    timeControl: control.id,
    initialMs: control.initialMs,
    incrementMs: control.incrementMs,
    playerColor: "white",
    rival: white.seat,
    fen: replay([]).fen,
    ply: 0,
    whiteMs: control.initialMs,
    blackMs: control.initialMs,
    turnStartedAt: now,
    aiLeaseUntil: null,
    aiError: null,
    status: "active",
    result: null,
    reason: null,
    createdAt: now,
    rated: false,
    rating: null,
  };
}

export type StartRefusal = "running" | "budget" | "no_pairing";
export type StartResult = { ok: true; game: Game } | { ok: false; reason: StartRefusal };

/**
 * Starts the next arena game, unless one is still going, the day's budget is
 * spent, or fewer than two models can be paired. `ignoreBudget` is for a game
 * the owner asks for by hand.
 */
export async function startArenaGame(deps: Deps, options: { ignoreBudget?: boolean } = {}): Promise<StartResult> {
  const now = deps.now();
  const day = dayKey(now);
  const models = await deps.entrants();
  return deps.db.transaction<StartResult>(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(${ARENA_LOCK})`);
    if (await activeArenaGame(tx)) return { ok: false, reason: "running" };
    if (!options.ignoreBudget && (await countArenaForDay(tx, day)) >= (await arenaGamesPerDay(tx))) {
      return { ok: false, reason: "budget" };
    }
    const pairing = nextPairing(await field(tx, models, day), await meetings(tx), deps.random);
    if (!pairing) return { ok: false, reason: "no_pairing" };
    const game = newGame(pairing, now);
    await insertGame(tx, game);
    return { ok: true, game };
  });
}

/** Why a run stopped playing: the game ended, another run has it, or this run's time is up. */
export type Drive = "over" | "busy" | "out_of_time";

/**
 * Plays an arena game turn after turn until it ends, or until there is no
 * room before `deadline` for one more call to the model whose turn it is.
 */
export async function driveArenaGame(deps: Deps, gameId: string, deadline: number): Promise<Drive> {
  for (;;) {
    const game = await getGame(deps.db, gameId);
    const seat = game && seatOf(game, turnAt(game.ply));
    if (!game || !seat || game.status !== "active") return "over";
    const now = deps.now();
    if (game.aiLeaseUntil !== null && game.aiLeaseUntil > now) return "busy";
    if (game.ply >= ARENA.maxPlies) {
      const draw = { status: "finished", result: "draw", reason: "move_limit" } as const;
      await finishGame(deps.db, game.id, draw, { expectedPly: game.ply });
      return "over";
    }
    const clockMs = turnAt(game.ply) === "white" ? game.whiteMs : game.blackMs;
    if (deadline - now < callTimeoutMs(clockMs, seat.provider)) return "out_of_time";
    await runAiTurn(deps, game.id, deadline);
  }
}

export type ArenaRun = { gameId: string | null; state: Drive | "idle" };

/**
 * One run of the arena. It carries on with the live game; if there is none
 * and `start` is set, it starts the next one when the day's budget allows.
 * A run that ends "out_of_time" should be followed by another.
 */
export async function runArena(deps: Deps, options: { start: boolean; deadline: number }): Promise<ArenaRun> {
  const live = await activeArenaGame(deps.db);
  const started = live || !options.start ? null : await startArenaGame(deps);
  const game = live ?? (started?.ok ? started.game : null);
  if (!game) return { gameId: null, state: "idle" };
  const state = await driveArenaGame(deps, game.id, options.deadline);
  if (state === "over") await settleRatings(deps.db);
  return { gameId: game.id, state };
}
