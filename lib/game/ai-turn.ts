import type { MoveResult } from "../ai/types";
import { budgetPool } from "../budget/pools";
import { pausePool } from "../budget/supply";
import { chargeMove, remainingMs } from "../chess/clock";
import { applyMove, replay } from "../chess/rules";
import {
  AI_JOB_BUDGET_MS, BUDGET, CREDENTIAL_ALLOWANCE_MS, FAST_CALL_TIMEOUT_MS, LEASE_MARGIN_MS, LLM_CALL_TIMEOUT_MS,
  MAX_INVALID_REPLIES, MAX_PROVIDER_FAILURES, isFastProvider,
} from "../config";
import { claimLease, commitMove, finishGame, getGame, listMoves, recordAttempt, renewLease } from "../db/games";
import { recordUsage } from "../db/usage";
import type { Deps } from "./deps";
import { dayKey } from "./limits";
import { opposite, turnAt, type Color, type Game, type Provider, type Seat } from "./types";

/**
 * Runs the AI's turn now for a fast opponent, or after the response for a slow
 * one. `game` and `history` are the game as the caller has just saved it,
 * which saves a fast opponent reading them back while the player waits.
 */
export async function startAiTurn(deps: Deps, game: Game, history: readonly string[]): Promise<void> {
  if (isFastProvider(game.provider)) await runAiTurn(deps, game.id, { game, history });
  else deps.schedule(() => runAiTurn(deps, game.id));
}

/** How long one call to the opponent may take, given the time left on its clock. */
export const callTimeoutMs = (leftMs: number, provider: Provider): number =>
  Math.min(leftMs, isFastProvider(provider) ? FAST_CALL_TIMEOUT_MS : LLM_CALL_TIMEOUT_MS);

// A lease must outlive everything one attempt can do: fetch (or refresh)
// credentials, make the call, and save the result.
const leaseUntil = (now: number, leftMs: number, provider: Provider): number =>
  now + (isFastProvider(provider) ? 0 : CREDENTIAL_ALLOWANCE_MS) + callTimeoutMs(leftMs, provider) + LEASE_MARGIN_MS;

const clockOf = (game: Game, color: Color): number => (color === "white" ? game.whiteMs : game.blackMs);
const zeroClock = (color: Color) => (color === "white" ? { whiteMs: 0 } : { blackMs: 0 });

// Every ending below is guarded by the ply this runner started on, so a
// runner that fell behind cannot end a game that has since moved on.
function loseOnTime(deps: Deps, game: Game, mover: Color): Promise<boolean> {
  const ending = { status: "finished", result: opposite(mover), reason: "timeout" } as const;
  return finishGame(deps.db, game.id, ending, { expectedPly: game.ply, ...zeroClock(mover) });
}

function forfeit(deps: Deps, game: Game, mover: Color): Promise<boolean> {
  const ending = { status: "finished", result: opposite(mover), reason: "illegal_move" } as const;
  return finishGame(deps.db, game.id, ending, { expectedPly: game.ply });
}

function abort(deps: Deps, game: Game): Promise<boolean> {
  const ending = { status: "aborted", result: null, reason: "provider_error" } as const;
  return finishGame(deps.db, game.id, ending, { expectedPly: game.ply });
}

type Ask = { history: string[]; rejected?: string; leftMs: number; refresh: boolean };

const NOT_CONNECTED = "not connected";

/** Asks the model for one move. Anything that stops it answering is a provider error. */
async function ask(deps: Deps, seat: Seat, a: Ask): Promise<MoveResult> {
  try {
    const adapter = await deps.adapterFor(seat, { refresh: a.refresh });
    if (!adapter) return { kind: "provider_error", message: NOT_CONNECTED };
    const position = replay(a.history);
    return await adapter({
      fen: position.fen,
      history: a.history,
      legalMoves: position.legal,
      color: position.turn,
      remainingMs: a.leftMs,
      model: seat.model,
      ...(seat.effort ? { effort: seat.effort } : {}),
      ...(a.rejected === undefined ? {} : { rejected: a.rejected }),
      signal: AbortSignal.timeout(callTimeoutMs(a.leftMs, seat.provider)),
    });
  } catch {
    return { kind: "provider_error", message: "adapter failed" };
  }
}

/**
 * Counts a call against the model's budget. A paid call that does not say
 * what it used is charged as an ordinary one, so the daily cap still closes
 * if a provider stops reporting. A free budget whose provider says "too many
 * requests" has hit a limit Gambit could not see, so it is closed for a while.
 */
async function noteUsage(deps: Deps, seat: Seat, result: MoveResult): Promise<void> {
  const pool = budgetPool(seat.provider, seat.model);
  if (!pool || (result.kind === "provider_error" && result.message === NOT_CONNECTED)) return;
  const now = deps.now();
  await recordUsage(deps.db, dayKey(now), seat, result.inputTokens ?? (pool.kind === "cents" ? BUDGET.tokensPerCall : 0));
  if (pool.kind === "requests" && result.kind === "provider_error" && result.message === "HTTP 429") {
    await pausePool(deps.db, pool, now);
  }
}

/** Saves the model's move, unless its clock ran out while it was thinking. */
async function play(deps: Deps, game: Game, mover: Color, history: string[], san: string): Promise<void> {
  const applied = applyMove(history, san);
  if (!applied) return;
  const now = deps.now();
  const charge = chargeMove(clockOf(game, mover), game.turnStartedAt, now, game.incrementMs);
  if (charge.flagged) {
    await loseOnTime(deps, game, mover);
    return;
  }
  await commitMove(deps.db, {
    gameId: game.id,
    expectedPly: game.ply,
    move: { san: applied.san, uci: applied.uci, fenAfter: applied.fen, spentMs: charge.spentMs },
    whiteMs: mover === "white" ? charge.nextMs : game.whiteMs,
    blackMs: mover === "black" ? charge.nextMs : game.blackMs,
    now,
    ...(applied.outcome ? { finish: { status: "finished" as const, ...applied.outcome } } : {}),
  });
}

/**
 * Plays the AI's move for a game, if it is the AI's turn and nobody else is
 * already doing so. Safe to call more than once for the same turn.
 *
 * One job cannot run for ever, so a runner that has no room left for another
 * full call gives up its lease and lets the next poll start a new runner.
 * The counts of failed attempts are kept in the database across that hand-over.
 *
 * `saved` is the game and its moves as the caller has just written them. It
 * is trusted only as far as the lease: a game that has since moved on or
 * ended is refused there.
 */
export async function runAiTurn(
  deps: Deps,
  gameId: string,
  saved?: { game: Game; history: readonly string[] },
): Promise<void> {
  const jobDeadline = deps.now() + AI_JOB_BUDGET_MS;
  const game = saved?.game ?? (await getGame(deps.db, gameId));
  if (!game || game.status !== "active") return;
  const mover = turnAt(game.ply);
  if (mover === game.playerColor) return;
  const started = deps.now();
  const startedWith = remainingMs(game, mover, started);
  if (startedWith <= 0) return void (await loseOnTime(deps, game, mover));
  let lease = leaseUntil(started, startedWith, game.provider);
  if (!(await claimLease(deps.db, game.id, game.ply, started, lease))) return;

  const history = saved ? [...saved.history] : (await listMoves(deps.db, game.id)).map((m) => m.san);
  let rejected: string | undefined;
  let refresh = false;
  for (let attempt = 0; ; attempt++) {
    const leftMs = remainingMs(game, mover, deps.now());
    if (leftMs <= 0) return void (await loseOnTime(deps, game, mover));
    if (attempt > 0) {
      const now = deps.now();
      const roomForCall = jobDeadline - now >= callTimeoutMs(leftMs, game.provider);
      const next = roomForCall ? leaseUntil(now, leftMs, game.provider) : now;
      if (!(await renewLease(deps.db, game.id, game.ply, lease, next)) || !roomForCall) return;
      lease = next;
    }
    const result = await ask(deps, game, { history, rejected, leftMs, refresh });
    if (result.kind === "move") {
      // Counted while the move is saved, not before it: the count is not something the player should wait for.
      await Promise.all([play(deps, game, mover, history, result.san), noteUsage(deps, game, result)]);
      return;
    }
    await noteUsage(deps, game, result);

    const why = result.kind === "provider_error" ? result.message : null;
    const counts = await recordAttempt(deps.db, game.id, game.ply, lease, result.kind, why);
    if (!counts) return; // another runner has the turn, or the game is over
    if (result.kind === "invalid") {
      rejected = result.raw;
      if (counts.invalid >= MAX_INVALID_REPLIES) return void (await forfeit(deps, game, mover));
      continue;
    }
    refresh = result.message === "HTTP 401";
    const clockLeft = remainingMs(game, mover, deps.now()) > 0;
    if (counts.failures >= MAX_PROVIDER_FAILURES && clockLeft) return void (await abort(deps, game));
  }
}
