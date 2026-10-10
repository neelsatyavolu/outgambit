import "server-only";
import { authorizeUrl, exchangeCode, generatePkce, parseCallback, type Tokens } from "@neelsatyavolu/shared-ai-auth";
import type { Db } from "../db/client";
import { saveSecret, type OAuthProvider } from "./credentials";
import { decrypt, encrypt } from "./crypto";

export const PENDING_TTL_MS = 10 * 60_000;

export type Exchange = (provider: OAuthProvider, code: string, verifier: string) => Promise<Tokens>;
export type OAuthResult = { ok: true } | { ok: false; error: string };

type Pending = { provider: OAuthProvider; verifier: string; state: string; expiresAt: number };

const EXPIRED = "That sign-in attempt expired. Start again.";
const GARBAGE = "That does not look like a callback URL or code.";

const fail = (error: string): OAuthResult => ({ ok: false, error });

/** Begins a sign-in. `pending` goes in an httpOnly cookie until the owner pastes the callback. */
export function startOAuth(provider: OAuthProvider, now: number): { url: string; pending: string } {
  const pkce = generatePkce();
  const pending: Pending = { provider, verifier: pkce.verifier, state: pkce.state, expiresAt: now + PENDING_TTL_MS };
  return { url: authorizeUrl(provider, pkce), pending: encrypt(JSON.stringify(pending)) };
}

function readPending(blob: string | undefined, provider: OAuthProvider, now: number): Pending | null {
  if (!blob) return null;
  try {
    const pending = JSON.parse(decrypt(blob)) as Partial<Pending>;
    const complete = pending.provider === provider && pending.verifier && pending.state && pending.expiresAt;
    return complete && now < pending.expiresAt! ? (pending as Pending) : null;
  } catch {
    return null;
  }
}

/** Checks what the owner pasted against the pending attempt and returns the code. */
function codeFrom(pasted: string, pending: Pending): { code: string } | { error: string } {
  const callback = parseCallback(pasted);
  if (callback.error === "invalid_callback") return { error: GARBAGE };
  if (callback.error) return { error: "The provider refused the sign-in. Start again." };
  if (!callback.code || /\s/.test(callback.code)) return { error: GARBAGE };
  // Grok can show a bare code with no state; ChatGPT always redirects with one.
  const bareCodeAllowed = pending.provider === "grok" && callback.state === null;
  if (!bareCodeAllowed && callback.state !== pending.state) {
    return { error: "That callback belongs to a different sign-in attempt. Start again." };
  }
  return { code: callback.code };
}

/** Completes a sign-in from the pasted callback URL or code and stores the tokens. */
export async function finishOAuth(
  db: Db,
  provider: OAuthProvider,
  pasted: string,
  pendingBlob: string | undefined,
  now: number,
  exchange: Exchange = exchangeCode,
): Promise<OAuthResult> {
  const pending = readPending(pendingBlob, provider, now);
  if (!pending) return fail(EXPIRED);
  const parsed = codeFrom(pasted, pending);
  if ("error" in parsed) return fail(parsed.error);
  let tokens: Tokens;
  try {
    tokens = await exchange(provider, parsed.code, pending.verifier);
  } catch {
    return fail("The provider rejected that code. Start again.");
  }
  await saveSecret(db, provider, { kind: "oauth", tokens }, now);
  return { ok: true };
}
