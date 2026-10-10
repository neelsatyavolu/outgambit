import { randomUUID } from "node:crypto";
import { replay } from "../chess/rules";
import { findTimeControl } from "../config";
import { activeGameFor, expireOverdue, insertGame } from "../db/games";
import type { OfferedModel } from "../owner/catalog";
import { startAiTurn } from "./ai-turn";
import type { Deps } from "./deps";
import { capacity, dayKey } from "./limits";
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

export type CreateError =
  | "unknown_model"
  | "bad_time_control"
  | "active_game"
  | "player_limit"
  | "network_limit"
  | "global_limit";

export type CreateResult = { ok: true; game: Game } | { ok: false; error: CreateError; activeGameId?: string };

// One lock for all game creation, so two requests cannot both take the last slot.
const CREATE_LOCK = 7426001;
const DEFAULT_EFFORT: Effort = "medium";

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
    effort: model.supportsEffort ? (input.effort ?? DEFAULT_EFFORT) : null,
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
    status: "active",
    result: null,
    reason: null,
    createdAt: now,
    rated: false,
    rating: null,
  };
}

/** Starts a game if the model is on offer and no daily limit is in the way. */
export async function createGame(deps: Deps, input: CreateInput): Promise<CreateResult> {
  const model = await deps.findModel(input.provider, input.model);
  if (!model) return { ok: false, error: "unknown_model" };
  const now = deps.now();
  const game = newGame(deps, input, model, now);
  if (!game) return { ok: false, error: "bad_time_control" };

  const refusal = await deps.db.transaction<CreateResult | null>(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(${CREATE_LOCK})`);
    // A game the player walked away from and lost on time must not block them.
    await expireOverdue(tx, now);
    const active = await activeGameFor(tx, input.playerId);
    if (active) return { ok: false, error: "active_game", activeGameId: active.id };
    const { blocked } = await capacity(tx, input.playerId, input.ipHash, now);
    if (blocked) return { ok: false, error: `${blocked}_limit` };
    await insertGame(tx, game);
    return null;
  });
  if (refusal) return refusal;

  if (game.playerColor === "black") await startAiTurn(deps, game);
  return { ok: true, game };
}
