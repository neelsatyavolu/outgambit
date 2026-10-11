import { DECISION_TIMEOUT_MS } from "../config";
import { decisionAdapter, type DecisionOptions } from "./decision";
import { typeSafeDecider } from "./jev";
import type { Adapter } from "./types";

export const MERCURY_URL = "https://api.inceptionlabs.ai/v1/decisions";
export const MERCURY_MODEL = "mercury-decide";

/**
 * Mercury Decide, Inception's decision model. The decisions endpoint takes
 * the same request shape as Jev: a state and two choice questions.
 */
export function mercuryAdapter(apiKey: string, options: DecisionOptions & { fetch?: typeof fetch } = {}): Adapter {
  const decide = typeSafeDecider({
    url: MERCURY_URL,
    apiKey,
    model: MERCURY_MODEL,
    timeoutMs: DECISION_TIMEOUT_MS,
    plainText: false,
    fetch: options.fetch ?? fetch,
  });
  return decisionAdapter(decide, options);
}

/** The cheapest possible call, to check a key. */
export async function testMercuryKey(apiKey: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const body = {
    model: MERCURY_MODEL,
    state: "ping",
    questions: { ok: { type: "noul", instructions: "Is this text a greeting or a ping?" } },
  };
  try {
    const response = await fetcher(MERCURY_URL, {
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
