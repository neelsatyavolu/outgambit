import { buildPrompt } from "./prompt";
import { errorName, providerError, toResult } from "./result";
import type { Adapter, MoveRequest } from "./types";

export type ChatConfig = {
  url: string;
  apiKey: string;
  /** How this provider spells reasoning effort. */
  effortField: "reasoning" | "reasoning_effort";
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

function effortFields(config: ChatConfig, request: MoveRequest): Record<string, unknown> {
  if (!request.effort) return {};
  return config.effortField === "reasoning"
    ? { reasoning: { effort: request.effort } }
    : { reasoning_effort: request.effort };
}

/** An adapter for any provider with an OpenAI-style chat completions endpoint. */
export function chatAdapter(config: ChatConfig): Adapter {
  const fetcher = config.fetch ?? fetch;
  return async (request) => {
    const prompt = buildPrompt(request);
    try {
      const response = await fetcher(config.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...config.headers,
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          ...effortFields(config, request),
        }),
        signal: request.signal,
      });
      if (!response.ok) return providerError(`HTTP ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body.choices?.[0]?.message?.content;
      return toResult(typeof content === "string" ? content : "", request.legalMoves);
    } catch (error) {
      return providerError(errorName(error));
    }
  };
}
