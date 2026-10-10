import { JEV_TIMEOUT_MS } from "../config";
import {
  decisionAdapter, instructionsText, probabilityMap, stateText,
  type Decider, type DecisionAnswer, type DecisionOptions, type DecisionQuery,
} from "./decision";
import type { Adapter } from "./types";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

type TypeSafeConfig = {
  url: string;
  apiKey: string;
  /** Overrides the model named by the game. */
  model?: string;
  timeoutMs: number;
  /** Send the state and instructions as plain strings, which every model on AI Gateway accepts. */
  plainText: boolean;
  fetch: typeof fetch;
};

type ChoiceAnswer = { choice?: unknown; probabilities?: unknown };

function bodyFor(query: DecisionQuery, config: TypeSafeConfig) {
  const question = (options: DecisionQuery["orderings"][number]) => ({
    type: "choice",
    instructions: config.plainText ? instructionsText(query.instructions) : query.instructions,
    criteria: Object.fromEntries(options.map((o) => [o.key, o.description])),
  });
  return {
    model: config.model ?? query.model,
    state: config.plainText ? stateText(query.state) : query.state,
    questions: { a: question(query.orderings[0]), b: question(query.orderings[1]) },
  };
}

const toAnswer = (answer: ChoiceAnswer | undefined): DecisionAnswer => ({
  choice: typeof answer?.choice === "string" ? answer.choice : null,
  probabilities: probabilityMap(answer?.probabilities),
});

/** Speaks TypeSafe's request shape, which Jev and Vercel AI Gateway's decision endpoint share. */
export function typeSafeDecider(config: TypeSafeConfig): Decider {
  return async (query) => {
    const response = await config.fetch(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(bodyFor(query, config)),
      signal: AbortSignal.any([query.signal, AbortSignal.timeout(config.timeoutMs)]),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const body = (await response.json()) as { answers?: { a?: ChoiceAnswer; b?: ChoiceAnswer } };
    if (!body.answers?.a && !body.answers?.b) return { error: "bad response" };
    return { answers: [toAnswer(body.answers.a), toAnswer(body.answers.b)] };
  };
}

/** Jev, TypeSafe's decision model: fast enough for bullet. */
export function jevAdapter(apiKey: string, options: DecisionOptions & { fetch?: typeof fetch } = {}): Adapter {
  const decide = typeSafeDecider({
    url: JEV_URL,
    apiKey,
    model: JEV_MODEL,
    timeoutMs: JEV_TIMEOUT_MS,
    plainText: false,
    fetch: options.fetch ?? fetch,
  });
  return decisionAdapter(decide, options);
}

/** The cheapest possible call, to check a key. */
export async function testJevKey(apiKey: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const body = {
    model: JEV_MODEL,
    state: "ping",
    questions: { ok: { type: "noul", instructions: "Is this text a greeting or a ping?" } },
  };
  try {
    const response = await fetcher(JEV_URL, {
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
