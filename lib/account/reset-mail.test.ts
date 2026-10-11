import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEmail, resetLink, sendResetLink } from "./reset-mail";

const TOKEN = "uK3_bV-9xQ2mZ7pL0aYtR5sW8eD1cF4gH6jN3kM2oI0";
const LINK = `https://outgambit.n3el.dev/account/reset?token=${TOKEN}`;

afterEach(() => vi.restoreAllMocks());

describe("resetLink", () => {
  it("points at the reset page on the site's own address", () => {
    expect(resetLink("https://outgambit.n3el.dev", TOKEN)).toBe(LINK);
    expect(resetLink("http://localhost:3000", TOKEN)).toBe(`http://localhost:3000/account/reset?token=${TOKEN}`);
  });
});

describe("resetEmail", () => {
  it("says what the email is for, in the words agreed", () => {
    const mail = resetEmail(LINK);
    expect(mail.subject).toBe("Reset your Gambit password");
    expect(mail.text).toBe(
      [
        "GAMBIT",
        "Reset your password",
        "Someone asked to reset the password for your Gambit account. If that was you, choose a new one below.",
        `Reset password: ${LINK}`,
        "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email and your password stays the same.",
      ].join("\n\n"),
    );
    expect(mail.html).toContain(`href="${LINK}"`);
    expect(mail.html).toContain("Or paste this link into your browser:");
    expect(mail.html).toContain("If you didn&#39;t ask for it");
  });
});

describe("sendResetLink", () => {
  it("emails the link through Resend, from Gambit", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await sendResetLink("ada@example.com", LINK, "re_secret_key", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer re_secret_key" });
    expect(JSON.parse(init?.body as string)).toMatchObject({
      from: "Gambit <no-reply@n3el.dev>",
      to: ["ada@example.com"],
      subject: "Reset your Gambit password",
      text: expect.stringContaining(LINK),
      html: expect.stringContaining(LINK),
    });
  });

  it("fails when Resend refuses the email", async () => {
    const refusing = vi.fn<typeof fetch>(async () => new Response("{}", { status: 422 }));
    await expect(sendResetLink("ada@example.com", LINK, "re_secret_key", refusing)).rejects.toThrow("HTTP 422");
  });

  it("with no key, writes the link to the server's console and calls nobody", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await sendResetLink("ada@example.com", LINK, undefined, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0].join(" ")).toContain("ada@example.com");
    expect(info.mock.calls[0].join(" ")).toContain(LINK);
  });
});
