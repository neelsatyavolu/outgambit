import { describe, expect, it, vi } from "vitest";
import { MailError, sendEmail } from "./send";

const mail = { to: "ada@example.com", subject: "Hello", html: "<p>Hello</p>", text: "Hello" };
const config = { apiKey: "re_secret_key", from: "Gambit <no-reply@n3el.dev>" };

const answering = (status: number) => vi.fn<typeof fetch>(async () => new Response("{}", { status }));

describe("sendEmail", () => {
  it("posts the message to Resend with the key as a bearer token", async () => {
    const fetchImpl = answering(200);
    await sendEmail(mail, config, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: "Bearer re_secret_key", "Content-Type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({
      from: config.from,
      to: ["ada@example.com"],
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 401, 422, 429, 500])("throws when Resend answers %i, without the key in the error", async (status) => {
    const error = await sendEmail(mail, config, answering(status)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).status).toBe(status);
    expect(String(error)).toContain(String(status));
    expect(JSON.stringify(error) + String(error) + (error as Error).stack).not.toContain(config.apiKey);
  });

  it("lets a network failure reach the caller", async () => {
    const down = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("fetch failed")));
    await expect(sendEmail(mail, config, down)).rejects.toThrow("fetch failed");
  });
});
