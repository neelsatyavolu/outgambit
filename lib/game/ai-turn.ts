import type { MoveResult } from "../ai/types";
import { chargeMove, remainingMs } from "../chess/clock";
import { applyMove, replay } from "../chess/rules";
import {
  LEASE_MARGIN_MS, LLM_CALL_TIMEOUT_MS, MAX_INVALID_REPLIES, MAX_PROVIDER_FAILURES, isFastProvider,
} from "../config";
import { claimLease, commitMove, finishGame, getGame, listMoves, renewLease } from "../db/games";
import type { Deps } from "./deps";
import { opposite, turnAt, type Color, type Game } from "./types";

/** Runs the AI's turn now for a fast opponent, or after the response for a slow one. */
export async function startAiTurn(deps: Deps, game: Pick<Game, "id" | "provider">): Promise<void> {
  if (isFastProvider(game.provider)) await runAiTurn(deps, game.id);
  else deps.schedule(() => runAiTurn(deps, game.id));
}

/** How long one call to the opponent may take, given the time left on its clock. */
export const callTimeoutMs = (leftMs: number): number => Math.min(leftMs, LLM_CALL_TIMEOUT_MS);

const clockOf = (game: Game, color: Color): number => (color === "white" ? game.whiteMs : game.blackMs);
const zeroClock = (color: Color) => (color === "white" ? { whiteMs: 0 } : { blackMs: 0 });

function loseOnTime(deps: Deps, game: Game, ai: Color): Promise<boolean> {
  return finishGame(deps.db, game.id, { status: "finished", result: game.playerColor, reason: "timeout" }, zeroClock(ai));
}

/** Asks the opponent for one move. Anything that stops it answering is a provider error. */
async function ask(deps: Deps, game: Game, history: string[], rejected: string | undefined, leftMs: number) {
  try {
    const adapter = await deps.adapterFor(game);
    if (!adapter) return { kind: "provider_error", message: "not connected" } as const;
    const position = replay(history);
    return await adapter({
      fen: position.fen,
      history,
      legalMoves: position.legal,
      color: position.turn,
      remainingMs: leftMs,
      model: game.model,
      ...(game.effort ? { effort: game.effort } : {}),
      ...(rejected === undefined ? {} : { rejected }),
      signal: AbortSignal.timeout(callTimeoutMs(leftMs)),
    });
  } catch {
    return { kind: "provider_error", message: "adapter failed" } as const;
  }
}

/** Saves the AI's move, unless its clock ran out while it was thinking. */
async function play(deps: Deps, game: Game, ai: Color, history: string[], san: string): Promise<void> {
  const applied = applyMove(history, san);
  if (!applied) return;
  const now = deps.now();
  const charge = chargeMove(clockOf(game, ai), game.turnStartedAt, now, game.incrementMs);
  if (charge.flagged) {
    await loseOnTime(deps, game, ai);
    return;
  }
  await commitMove(deps.db, {
    gameId: game.id,
    expectedPly: game.ply,
    move: { san: applied.san, uci: applied.uci, fenAfter: applied.fen, spentMs: charge.spentMs },
    whiteMs: ai === "white" ? charge.nextMs : game.whiteMs,
    blackMs: ai === "black" ? charge.nextMs : game.blackMs,
    now,
    ...(applied.outcome ? { finish: { status: "finished" as const, ...applied.outcome } } : {}),
  });
}

/**
 * Plays the AI's move for a game, if it is the AI's turn and nobody else is
 * already doing so. Safe to call more than once for the same turn.
 */
export async function runAiTurn(deps: Deps, gameId: string): Promise<void> {
  const game = await getGame(deps.db, gameId);
  if (!game || game.status !== "active" || turnAt(game.ply) === game.playerColor) return;
  const ai = opposite(game.playerColor);
  const startedWith = remainingMs(game, ai, deps.now());
  if (startedWith <= 0) return void (await loseOnTime(deps, game, ai));
  const leaseFor = (left: number) => deps.now() + callTimeoutMs(left) + LEASE_MARGIN_MS;
  if (!(await claimLease(deps.db, game.id, game.ply, deps.now(), leaseFor(startedWith)))) return;

  const history = (await listMoves(deps.db, game.id)).map((m) => m.san);
  let invalid = 0;
  let failures = 0;
  let rejected: string | undefined;
  for (;;) {
    const left = remainingMs(game, ai, deps.now());
    if (left <= 0) return void (await loseOnTime(deps, game, ai));
    await renewLease(deps.db, game.id, game.ply, leaseFor(left));
    const result: MoveResult = await ask(deps, game, history, rejected, left);
    if (result.kind === "move") return play(deps, game, ai, history, result.san);
    if (result.kind === "invalid") {
      rejected = result.raw;
      invalid += 1;
      if (invalid >= MAX_INVALID_REPLIES) {
        const ending = { status: "finished", result: game.playerColor, reason: "illegal_move" } as const;
        return void (await finishGame(deps.db, game.id, ending));
      }
      continue;
    }
    failures += 1;
    if (failures >= MAX_PROVIDER_FAILURES && remainingMs(game, ai, deps.now()) > 0) {
      const ending = { status: "aborted", result: null, reason: "provider_error" } as const;
      return void (await finishGame(deps.db, game.id, ending));
    }
  }
}
