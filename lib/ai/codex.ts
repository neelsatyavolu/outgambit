import type { Tokens } from "@neelsatyavolu/shared-ai-auth";
import { buildPrompt } from "./prompt";
import { errorName, providerError, toResult } from "./result";
import type { Adapter } from "./types";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

type StreamEvent = {
  type?: string;
  delta?: unknown;
  text?: unknown;
  error?: unknown;
  response?: { error?: unknown };
};

/** Collects the output text from the ChatGPT "responses" event stream. Null means the stream reported an error. */
export function readResponsesStream(stream: string): string | null {
  let text = "";
  for (const line of stream.split(/\n+/)) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    let event: StreamEvent;
    try {
      event = JSON.parse(data) as StreamEvent;
    } catch {
      continue;
    }
    if (event.error || event.response?.error) return null;
    if (event.type === "response.output_text.done" && typeof event.text === "string") return event.text;
    if (typeof event.delta === "string") text += event.delta;
  }
  return text;
}

/** ChatGPT through the owner's subscription sign-in, as the Codex CLI calls it. */
export function codexAdapter(tokens: Tokens, fetcher: typeof fetch = fetch): Adapter {
  return async (request) => {
    const prompt = buildPrompt(request);
    try {
      const response = await fetcher(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          originator: "codex_cli_rs",
          "OpenAI-Beta": "responses=v1",
          ...(tokens.accountId ? { "chatgpt-account-id": tokens.accountId } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          instructions: prompt.system,
          input: [{ role: "user", content: [{ type: "input_text", text: prompt.user }] }],
          ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
          store: false,
          stream: true,
        }),
        signal: request.signal,
      });
      if (!response.ok) return providerError(`HTTP ${response.status}`);
      const text = readResponsesStream(await response.text());
      return text === null ? providerError("stream error") : toResult(text, request.legalMoves);
    } catch (error) {
      return providerError(errorName(error));
    }
  };
}
