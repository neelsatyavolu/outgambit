import { describeMove, textBoard } from "../chess/describe";
import type { LegalMove } from "../chess/rules";
import { JEV_TIMEOUT_MS } from "../config";
import { numberedMoves } from "./prompt";
import { errorName, providerError } from "./result";
import type { Adapter, MoveRequest } from "./types";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

type JevOptions = { fetch?: typeof fetch; rng?: () => number };

/** Fisher-Yates on a copy. jev-1.13 leans toward the first option, so the order must not be fixed. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Jev cannot write a move; it picks one option. Every legal move is an
// option, keyed by its UCI string (a Choice accepts up to 255 options).
function buildBody(request: MoveRequest, options: readonly LegalMove[]) {
  return {
    model: JEV_MODEL,
    state: {
      side_to_move: request.color,
      board: textBoard(request.fen),
      position_fen: request.fen,
      moves_so_far: numberedMoves(request.history),
    },
    questions: {
      move: {
        type: "choice",
        instructions: "Which option is the strongest chess move for `side_to_move` in the position shown in `board`?",
        criteria: Object.fromEntries(options.map((m) => [m.uci, describeMove(m)])),
      },
    },
  };
}

function post(apiKey: string, body: unknown, fetcher: typeof fetch, signal: AbortSignal): Promise<Response> {
  return fetcher(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Jev, TypeSafe's decision model: fast enough for bullet. */
export function jevAdapter(apiKey: string, options: JevOptions = {}): Adapter {
  const fetcher = options.fetch ?? fetch;
  const rng = options.rng ?? Math.random;
  return async (request) => {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(JEV_TIMEOUT_MS)]);
    try {
      const response = await post(apiKey, buildBody(request, shuffled(request.legalMoves, rng)), fetcher, signal);
      if (!response.ok) return providerError(`HTTP ${response.status}`);
      const body = (await response.json()) as { answers?: { move?: { choice?: unknown } } };
      const choice = body.answers?.move?.choice;
      if (typeof choice !== "string") return providerError("bad response");
      const move = request.legalMoves.find((m) => m.uci === choice);
      return move ? { kind: "move", san: move.san } : { kind: "invalid", raw: choice };
    } catch (error) {
      return providerError(errorName(error));
    }
  };
}

/** The cheapest possible call, to check a key. */
export async function testJevKey(apiKey: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const body = {
    model: JEV_MODEL,
    state: "ping",
    questions: { ok: { type: "noul", instructions: "Is this text a greeting or a ping?" } },
  };
  try {
    return (await post(apiKey, body, fetcher, AbortSignal.timeout(8_000))).ok;
  } catch {
    return false;
  }
}
