import "server-only";
import { sendEmail } from "../mail/send";
import { renderEmail, type RenderedEmail } from "../mail/template";

// The domain is verified in Resend.
const FROM = "Gambit <no-reply@n3el.dev>";
const RESET_PATH = "/account/reset";

/**
 * The address of the page that sets a new password. `appUrl` is the site's
 * configured address: a link built on a request's Host header could be
 * pointed at someone else's site by whoever sent the request.
 */
export function resetLink(appUrl: string, token: string): string {
  const url = new URL(RESET_PATH, appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function resetEmail(url: string): RenderedEmail {
  return renderEmail({
    app: "Gambit",
    subject: "Reset your Gambit password",
    heading: "Reset your password",
    body: "Someone asked to reset the password for your Gambit account. If that was you, choose a new one below.",
    button: "Reset password",
    url,
    linkHint: "Or paste this link into your browser:",
    footer: "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email and your password stays the same.",
  });
}

/**
 * Emails a reset link. With no Resend key, which only a server outside
 * production may be, the link goes to the server's console instead, so
 * local development needs no mail account.
 */
export async function sendResetLink(
  to: string,
  url: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!apiKey) {
    console.info(`[gambit] no RESEND_API_KEY, so the reset link for ${to} is not emailed: ${url}`);
    return;
  }
  await sendEmail({ to, ...resetEmail(url) }, { apiKey, from: FROM }, fetchImpl);
}
