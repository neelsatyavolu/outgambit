import { randomUUID } from "node:crypto";
import { allowance, loadDemand, type Blocked } from "../budget/allowance";
import { supplies } from "../budget/supply";
import { replay } from "../chess/rules";
import { effortFor, findTimeControl } from "../config";
import { activeGameFor, expireOverdue, insertGame } from "../db/games";
import type { OfferedModel } from "../owner/catalog";
import { startAiTurn } from "./ai-turn";
import type { Deps } from "./deps";
import { dayKey } from "./limits";
import type { Color, Effort, Game, Provider } from "./types";

export type CreateInput = {
  playerId: string;
  ipHash: string;
  provider: Provider;
  model: string;
  effort: Effort | null;
  timeControl: string;
  color: Color | "random";
};

export type CreateError = "unknown_model" | "bad_time_control" | "active_game" | "no_games_left";

export type CreateResult =
  | { ok: true; game: Game }
  /** `blocked` says which budget or share stood in the way of a "no_games_left". */
  | { ok: false; error: CreateError; activeGameId?: string; blocked?: Blocked };

// One lock for all game creation, so two requests cannot both take the last slot.
const CREATE_LOCK = 7426001;
const DEFAULT_EFFORT: Effort = "low";

function newGame(deps: Deps, input: CreateInput, model: OfferedModel, now: number): Game | null {
  const control = findTimeControl(input.timeControl);
  if (!control || !model.timeControls.includes(control.id)) return null;
  const playerColor = input.color === "random" ? (deps.random() < 0.5 ? "white" : "black") : input.color;
  return {
    id: randomUUID(),
    playerId: input.playerId,
    ipHash: input.ipHash,
    day: dayKey(now),
    provider: model.provider,
    model: model.id,
    modelLabel: model.label,
    effort: model.supportsEffort ? effortFor(model.provider, model.id, input.effort ?? DEFAULT_EFFORT) : null,
    timeControl: control.id,
    initialMs: control.initialMs,
    incrementMs: control.incrementMs,
    playerColor,
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

/** Starts a game if the model is on offer and neither its budget nor the player's share of it is in the way. */
export async function createGame(deps: Deps, input: CreateInput): Promise<CreateResult> {
  const model = await deps.findModel(input.provider, input.model);
  if (!model) return { ok: false, error: "unknown_model" };
  const now = deps.now();
  const game = newGame(deps, input, model, now);
  if (!game) return { ok: false, error: "bad_time_control" };
  // Read before taking the lock: this may have to ask the provider.
  const [supply] = await supplies(deps.db, deps.usage, [{ provider: model.provider, model: model.id }], now);

  const refusal = await deps.db.transaction<CreateResult | null>(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(${CREATE_LOCK})`);
    // A game the player walked away from and lost on time must not block them.
    await expireOverdue(tx, now);
    const active = await activeGameFor(tx, input.playerId);
    if (active) return { ok: false, error: "active_game", activeGameId: active.id };
    const blocked = supply && allowance(supply, await loadDemand(tx, input, now))?.blocked;
    if (blocked) return { ok: false, error: "no_games_left", blocked };
    game.turnStartedAt = deps.now();
    await insertGame(tx, game);
    return null;
  });
  if (refusal) return refusal;

  if (game.playerColor === "black") await startAiTurn(deps, game, []);
  return { ok: true, game };
}
