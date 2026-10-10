import { DECISION_TIMEOUT_MS } from "../config";
import {
  decisionAdapter, instructionsText, stateText,
  type Decider, type DecisionAnswer, type DecisionOptions, type DecisionQuery,
} from "./decision";
import type { Adapter } from "./types";

export const OPENAI_DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const OPENAI_DECISIONS_MODEL = "gpt-6-luna";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

type Listed = { value?: unknown; probability?: unknown };
type Answer = { type?: unknown; name?: unknown; choice?: unknown; probabilities?: unknown };

function question(name: string, query: DecisionQuery, options: DecisionQuery["orderings"][number]) {
  return {
    type: "choice",
    name,
    instructions: instructionsText(query.instructions),
    choices: options.map((o) => ({ value: o.key, description: o.description })),
  };
}

function toAnswer(answer: Answer): DecisionAnswer {
  const listed = Array.isArray(answer.probabilities) ? (answer.probabilities as Listed[]) : [];
  const pairs = listed.filter((p): p is { value: string; probability: number } =>
    typeof p.value === "string" && typeof p.probability === "number",
  );
  return {
    choice: typeof answer.choice === "string" ? answer.choice : null,
    probabilities: Object.fromEntries(pairs.map((p) => [p.value, p.probability])),
  };
}

function openAiDecider(apiKey: string, fetcher: typeof fetch): Decider {
  return async (query) => {
    const response = await fetcher(OPENAI_DECISIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_DECISIONS_MODEL,
        input: stateText(query.state),
        questions: [question("a", query, query.orderings[0]), question("b", query, query.orderings[1])],
      }),
      signal: AbortSignal.any([query.signal, AbortSignal.timeout(DECISION_TIMEOUT_MS)]),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const body = (await response.json()) as { answers?: Answer[] };
    const chosen = (body.answers ?? []).filter((a) => a.type === "choice");
    return chosen.length > 0 ? { answers: chosen.map(toAnswer) } : { error: "refused" };
  };
}

/** OpenAI's Decisions API (`POST /v1/decisions`), which picks from options the way Jev does. */
export function openAiDecisionsAdapter(apiKey: string, options: DecisionOptions & { fetch?: typeof fetch } = {}): Adapter {
  return decisionAdapter(openAiDecider(apiKey, options.fetch ?? fetch), options);
}

export async function testOpenAiKey(apiKey: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
