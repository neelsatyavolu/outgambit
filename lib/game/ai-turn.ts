import type { MoveResult } from "../ai/types";
import { chargeMove, remainingMs } from "../chess/clock";
import { applyMove, replay } from "../chess/rules";
import {
  AI_JOB_BUDGET_MS, CREDENTIAL_ALLOWANCE_MS, FAST_CALL_TIMEOUT_MS, LEASE_MARGIN_MS, LLM_CALL_TIMEOUT_MS,
  MAX_INVALID_REPLIES, MAX_PROVIDER_FAILURES, isFastProvider,
} from "../config";
import { claimLease, commitMove, finishGame, getGame, listMoves, recordAttempt, renewLease } from "../db/games";
import type { Deps } from "./deps";
import { opposite, turnAt, type Color, type Game, type Provider } from "./types";

/** Runs the AI's turn now for a fast opponent, or after the response for a slow one. */
export async function startAiTurn(deps: Deps, game: Pick<Game, "id" | "provider">): Promise<void> {
  if (isFastProvider(game.provider)) await runAiTurn(deps, game.id);
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
function loseOnTime(deps: Deps, game: Game, ai: Color): Promise<boolean> {
  const ending = { status: "finished", result: game.playerColor, reason: "timeout" } as const;
  return finishGame(deps.db, game.id, ending, { expectedPly: game.ply, ...zeroClock(ai) });
}

function forfeit(deps: Deps, game: Game): Promise<boolean> {
  const ending = { status: "finished", result: game.playerColor, reason: "illegal_move" } as const;
  return finishGame(deps.db, game.id, ending, { expectedPly: game.ply });
}

function abort(deps: Deps, game: Game): Promise<boolean> {
  const ending = { status: "aborted", result: null, reason: "provider_error" } as const;
  return finishGame(deps.db, game.id, ending, { expectedPly: game.ply });
}

type Ask = { history: string[]; rejected?: string; leftMs: number; refresh: boolean };

/** Asks the opponent for one move. Anything that stops it answering is a provider error. */
async function ask(deps: Deps, game: Game, a: Ask): Promise<MoveResult> {
  try {
    const adapter = await deps.adapterFor(game, { refresh: a.refresh });
    if (!adapter) return { kind: "provider_error", message: "not connected" };
    const position = replay(a.history);
    return await adapter({
      fen: position.fen,
      history: a.history,
      legalMoves: position.legal,
      color: position.turn,
      remainingMs: a.leftMs,
      model: game.model,
      ...(game.effort ? { effort: game.effort } : {}),
      ...(a.rejected === undefined ? {} : { rejected: a.rejected }),
      signal: AbortSignal.timeout(callTimeoutMs(a.leftMs, game.provider)),
    });
  } catch {
    return { kind: "provider_error", message: "adapter failed" };
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
 *
 * One job cannot run for ever, so a runner that has no room left for another
 * full call gives up its lease and lets the next poll start a new runner.
 * The counts of failed attempts are kept in the database across that hand-over.
 */
export async function runAiTurn(deps: Deps, gameId: string): Promise<void> {
  const jobDeadline = deps.now() + AI_JOB_BUDGET_MS;
  const game = await getGame(deps.db, gameId);
  if (!game || game.status !== "active" || turnAt(game.ply) === game.playerColor) return;
  const ai = opposite(game.playerColor);
  const startedWith = remainingMs(game, ai, deps.now());
  if (startedWith <= 0) return void (await loseOnTime(deps, game, ai));
  let lease = leaseUntil(deps.now(), startedWith, game.provider);
  if (!(await claimLease(deps.db, game.id, game.ply, deps.now(), lease))) return;

  const history = (await listMoves(deps.db, game.id)).map((m) => m.san);
  let rejected: string | undefined;
  let refresh = false;
  for (let attempt = 0; ; attempt++) {
    const leftMs = remainingMs(game, ai, deps.now());
    if (leftMs <= 0) return void (await loseOnTime(deps, game, ai));
    if (attempt > 0) {
      const now = deps.now();
      const roomForCall = jobDeadline - now >= callTimeoutMs(leftMs, game.provider);
      const next = roomForCall ? leaseUntil(now, leftMs, game.provider) : now;
      if (!(await renewLease(deps.db, game.id, game.ply, lease, next)) || !roomForCall) return;
      lease = next;
    }
    const result = await ask(deps, game, { history, rejected, leftMs, refresh });
    if (result.kind === "move") return play(deps, game, ai, history, result.san);

    const counts = await recordAttempt(deps.db, game.id, game.ply, lease, result.kind);
    if (!counts) return; // another runner has the turn, or the game is over
    if (result.kind === "invalid") {
      rejected = result.raw;
      if (counts.invalid >= MAX_INVALID_REPLIES) return void (await forfeit(deps, game));
      continue;
    }
    refresh = result.message === "HTTP 401";
    const clockLeft = remainingMs(game, ai, deps.now()) > 0;
    if (counts.failures >= MAX_PROVIDER_FAILURES && clockLeft) return void (await abort(deps, game));
  }
}
