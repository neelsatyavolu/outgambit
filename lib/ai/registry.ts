import "server-only";
import type { Db } from "../db/client";
import type { Provider } from "../game/types";
import { getCredentials } from "../owner/credentials";
import { codexAdapter } from "./codex";
import { fakeAdapter } from "./fake";
import { isFreeModel } from "./free-models";
import { jevAdapter } from "./jev";
import { chatAdapter } from "./openai-chat";
import type { Adapter } from "./types";

const GROK_URL = "https://api.x.ai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The scripted opponent exists for tests only and can never run in production. */
export const fakeEnabled = (): boolean =>
  process.env.GAMBIT_FAKE_AI === "1" && process.env.NODE_ENV !== "production";

const fakeScript = (): string[] => (process.env.GAMBIT_FAKE_SCRIPT ?? "").split(",").filter(Boolean);

/**
 * The last line of defence for "OpenRouter and Gemini never cost money":
 * whatever a game row says, a model that is not free is never sent.
 */
function freeOnly(provider: Provider, adapter: Adapter): Adapter {
  return async (request) =>
    isFreeModel(provider, request.model) ? adapter(request) : { kind: "provider_error", message: "not a free model" };
}

/** The adapter for a provider, using the owner's stored credentials. Null if it is not connected. */
export async function getAdapter(
  db: Db,
  provider: Provider,
  now: number,
  fetcher: typeof fetch = fetch,
  options: { refresh?: boolean } = {},
): Promise<Adapter | null> {
  if (provider === "fake") return fakeEnabled() ? fakeAdapter(fakeScript()) : null;
  const secret = await getCredentials(db, provider, now, undefined, { force: options.refresh });
  if (!secret) return null;
  if (secret.kind === "oauth") {
    if (provider === "codex") return codexAdapter(secret.tokens, fetcher);
    if (provider === "grok") {
      return chatAdapter({
        url: GROK_URL,
        apiKey: secret.tokens.accessToken,
        effortField: "reasoning",
        headers: { "User-Agent": "grok-cli/1.0" },
        fetch: fetcher,
      });
    }
    return null;
  }
  if (provider === "gemini") {
    const gemini = chatAdapter({ url: GEMINI_URL, apiKey: secret.apiKey, effortField: "reasoning_effort", fetch: fetcher });
    return freeOnly(provider, gemini);
  }
  if (provider === "openrouter") {
    const openRouter = chatAdapter({
      url: OPENROUTER_URL,
      apiKey: secret.apiKey,
      effortField: "reasoning",
      headers: { "X-Title": "Gambit" },
      fetch: fetcher,
    });
    return freeOnly(provider, openRouter);
  }
  if (provider === "jev") return jevAdapter(secret.apiKey, { fetch: fetcher });
  return null;
}
