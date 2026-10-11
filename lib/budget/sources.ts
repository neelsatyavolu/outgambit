import "server-only";
import { errorName } from "../ai/result";
import { BUDGET } from "../config";
import type { Db } from "../db/client";
import { getCredentials, type Refresh } from "../owner/credentials";
import { readCodexMeter, readGrokMeter } from "./meter";
import { reading } from "./readings";
import type { UsageSource } from "./supply";

const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

/** Whether the OpenRouter account has ever bought credits, which is what raises its free-model limit. */
async function readOpenRouterTier(apiKey: string, fetcher: typeof fetch): Promise<{ paid: boolean } | string> {
  try {
    const response = await fetcher(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return `HTTP ${response.status}`;
    const body = (await response.json()) as { data?: { is_free_tier?: unknown } };
    return typeof body.data?.is_free_tier === "boolean" ? { paid: !body.data.is_free_tier } : "bad response";
  } catch (error) {
    return errorName(error);
  }
}

/** The providers' own figures, read with the owner's stored credentials. */
export function usageSource(db: Db, fetcher: typeof fetch = fetch, refresh?: Refresh): UsageSource {
  return {
    meter: (provider, now) =>
      reading(db, provider, now, async () => {
        const read = provider === "codex" ? readCodexMeter : readGrokMeter;
        const secret = await getCredentials(db, provider, now, refresh);
        if (secret?.kind !== "oauth") return "not connected";
        const first = await read(secret.tokens, fetcher);
        if (first !== "HTTP 401") return first;
        // The provider has rejected a sign-in that had not expired: renew it once and ask again.
        const renewed = await getCredentials(db, provider, now, refresh, { force: true });
        return renewed?.kind === "oauth" ? read(renewed.tokens, fetcher) : first;
      }),
    // Without a reading, assume the lower limit: guessing high would only earn refusals.
    openRouterCap: async (now) => {
      const tier = await reading(db, "openrouter", now, async () => {
        const secret = await getCredentials(db, "openrouter", now);
        return secret?.kind === "key" ? readOpenRouterTier(secret.apiKey, fetcher) : "not connected";
      });
      return tier.value?.paid ? BUDGET.openRouterRequestsPerDay.paid : BUDGET.openRouterRequestsPerDay.free;
    },
  };
}
