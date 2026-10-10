import { DECISION_TIMEOUT_MS } from "../config";
import { decisionAdapter, type DecisionOptions } from "./decision";
import { typeSafeDecider } from "./jev";
import type { Adapter } from "./types";

export const GATEWAY_EVALUATE_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
export const GATEWAY_CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

/**
 * Decision models served by Vercel AI Gateway (Liquid d1, Microsoft
 * Decision-1 and others). The endpoint takes TypeSafe's request shape; the
 * model is whichever one the game names.
 */
export function gatewayAdapter(apiKey: string, options: DecisionOptions & { fetch?: typeof fetch } = {}): Adapter {
  const decide = typeSafeDecider({
    url: GATEWAY_EVALUATE_URL,
    apiKey,
    timeoutMs: DECISION_TIMEOUT_MS,
    plainText: true,
    fetch: options.fetch ?? fetch,
  });
  return decisionAdapter(decide, options);
}
