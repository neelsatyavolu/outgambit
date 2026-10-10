import type { MoveRequest } from "@/lib/ai/types";
import { replay } from "@/lib/chess/rules";

/** A move request for the position reached by `history`. */
export function requestFor(history: string[] = [], overrides: Partial<MoveRequest> = {}): MoveRequest {
  const position = replay(history);
  return {
    fen: position.fen,
    history,
    legalMoves: position.legal,
    color: position.turn,
    remainingMs: 582_000,
    model: "model-x",
    signal: new AbortController().signal,
    ...overrides,
  };
}

export type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** A fetch stand-in that records each call and answers with `respond`. */
export function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetcher, calls };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
