/** Sends one email through Resend's HTTP API. No SDK: it is a single POST. */

export type Mail = { to: string; subject: string; html: string; text: string };

export type MailConfig = {
  /** Resend API key. */
  apiKey: string;
  /** Sender, e.g. `Gambit <no-reply@n3el.dev>`. The domain must be verified in Resend. */
  from: string;
};

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export class MailError extends Error {
  constructor(readonly status: number) {
    super(`Resend refused the email (HTTP ${status})`);
    this.name = "MailError";
  }
}

export async function sendEmail(
  mail: Mail,
  config: MailConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) throw new MailError(response.status);
}
