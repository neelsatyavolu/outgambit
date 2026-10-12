import { DECISION_TIMEOUT_MS } from "../config";
import { decisionAdapter, type DecisionOptions } from "./decision";
import { typeSafeDecider } from "./jev";
import type { Adapter } from "./types";

export const SUBQ_URL = "https://api.subq.ai/v1/systemone";
export const SUBQ_MODEL = "subq-snap-preview";

/**
 * SubQ Snap, Subquadratic's decision model. The endpoint takes the same
 * request shape as Jev: a state and two choice questions.
 */
export function subqAdapter(apiKey: string, options: DecisionOptions & { fetch?: typeof fetch } = {}): Adapter {
  const decide = typeSafeDecider({
    url: SUBQ_URL,
    apiKey,
    model: SUBQ_MODEL,
    timeoutMs: DECISION_TIMEOUT_MS,
    plainText: false,
    fetch: options.fetch ?? fetch,
  });
  return decisionAdapter(decide, options);
}

/** The cheapest possible call, to check a key. */
export async function testSubqKey(apiKey: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const body = {
    model: SUBQ_MODEL,
    state: "ping",
    questions: { ok: { type: "noul", instructions: "Is this text a greeting or a ping?" } },
  };
  try {
    const response = await fetcher(SUBQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
