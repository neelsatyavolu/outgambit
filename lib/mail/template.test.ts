import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail } from "./template";

const copy = {
  app: "Gambit",
  subject: "Reset your Gambit password",
  heading: "Reset your password",
  body: "Someone asked to reset the password for your Gambit account.",
  button: "Reset password",
  url: "https://gambit.test/account/reset?token=abc-123_XYZ",
  linkHint: "Or paste this link into your browser:",
  footer: "This link works once and expires in 1 hour.",
};

describe("escapeHtml", () => {
  it("escapes everything that could open a tag, an entity or an attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("renderEmail", () => {
  it("passes the subject through and puts every line of copy in the page", () => {
    const mail = renderEmail(copy);
    expect(mail.subject).toBe(copy.subject);
    for (const line of [copy.heading, copy.body, copy.button, copy.linkHint, copy.footer]) expect(mail.html).toContain(line);
    expect(mail.html).toContain('<html lang="en">');
  });

  it("links the button and writes the link out in full", () => {
    const { html } = renderEmail(copy);
    expect(html.split(`href="${copy.url}"`)).toHaveLength(3);
    expect(html).toContain(`>${copy.url}</a>`);
  });

  it("escapes hostile values wherever they land", () => {
    const hostile = `"><script>alert('x')</script>&`;
    const { html } = renderEmail({
      ...copy,
      app: hostile,
      subject: hostile,
      heading: hostile,
      body: hostile,
      button: hostile,
      url: `https://gambit.test/?a=1&b="><script>`,
      linkHint: hostile,
      footer: hostile,
      lang: hostile,
    });
    expect(html).not.toContain("<script>");
    // No value opened a tag of its own: the page has exactly the tags of an ordinary one.
    const tags = (page: string) => page.match(/<[a-z!/]/gi)!.length;
    expect(tags(html)).toBe(tags(renderEmail(copy).html));
    expect(html).toContain('href="https://gambit.test/?a=1&amp;b=&quot;&gt;&lt;script&gt;"');
  });

  it("uses the language it is given", () => {
    expect(renderEmail({ ...copy, lang: "te" }).html).toContain('<html lang="te">');
  });

  it("has a plain-text version with the link, and no markup", () => {
    const { text } = renderEmail(copy);
    expect(text).toBe(
      ["GAMBIT", copy.heading, copy.body, `Reset password: ${copy.url}`, copy.footer].join("\n\n"),
    );
    expect(text).not.toMatch(/<[a-z]/i);
  });
});
