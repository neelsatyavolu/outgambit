/**
 * One transactional email layout, shared by every message the app sends.
 * Mail clients ignore stylesheets and web fonts, so everything is inline, laid out
 * with tables, and uses solid colors (the site's translucent tokens flattened onto --bg).
 */

export type EmailCopy = {
  /** Product name, shown as the wordmark. */
  app: string;
  subject: string;
  heading: string;
  /** One or two plain sentences. */
  body: string;
  /** Label of the single button. */
  button: string;
  url: string;
  /** Sentence above the link written out in full. */
  linkHint: string;
  /** Small print: expiry and what to do if the reader did not ask for this. */
  footer: string;
  /** BCP 47 language tag of the copy. */
  lang?: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

// Blackletter tokens (see ~/DESIGN.md), flattened onto the black canvas.
const BG = "#000000";
const FG = "#FCFDFF";
const FG_2 = "#B1B2B3";
const FG_3 = "#888E90";
const BORDER = "#242424";
const BUTTON = "#FCFDFF";
const BUTTON_TEXT = "#000000";

// Web fonts do not load reliably in mail clients: Georgia for the display line, system sans for the rest.
const SANS = "ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function renderText(copy: EmailCopy): string {
  return [
    copy.app.toUpperCase(),
    copy.heading,
    copy.body,
    `${copy.button}: ${copy.url}`,
    copy.footer,
  ].join("\n\n");
}

function renderHtml(copy: EmailCopy): string {
  const app = escapeHtml(copy.app);
  const url = escapeHtml(copy.url);
  return `<!doctype html>
<html lang="${escapeHtml(copy.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">${escapeHtml(copy.body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:48px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;text-align:left;">
<tr><td style="padding-bottom:24px;border-bottom:1px solid ${BORDER};font-family:${SANS};font-size:15px;line-height:20px;font-weight:500;letter-spacing:-0.02em;color:${FG};">${app}</td></tr>
<tr><td style="padding-top:40px;font-family:${SERIF};font-size:40px;line-height:40px;font-weight:400;letter-spacing:-0.02em;color:${FG};">${escapeHtml(copy.heading)}</td></tr>
<tr><td style="padding-top:20px;font-family:${SANS};font-size:16px;line-height:26px;color:${FG_2};">${escapeHtml(copy.body)}</td></tr>
<tr><td style="padding-top:32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${BUTTON}" style="background:${BUTTON};border-radius:8px;"><a href="${url}" style="display:inline-block;padding:11px 18px;border-radius:8px;font-family:${SANS};font-size:14px;line-height:16px;font-weight:500;color:${BUTTON_TEXT};text-decoration:none;">${escapeHtml(copy.button)}</a></td></tr></table>
</td></tr>
<tr><td style="padding-top:32px;font-family:${SANS};font-size:13px;line-height:20px;color:${FG_2};">${escapeHtml(copy.linkHint)}</td></tr>
<tr><td style="padding-top:4px;font-family:${SANS};font-size:13px;line-height:20px;word-break:break-all;"><a href="${url}" style="color:${FG_2};text-decoration:underline;">${url}</a></td></tr>
<tr><td style="padding-top:32px;"><div style="border-top:1px solid ${BORDER};padding-top:16px;font-family:${SANS};font-size:12px;line-height:18px;color:${FG_3};">${escapeHtml(copy.footer)}</div></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderEmail(copy: EmailCopy): RenderedEmail {
  return { subject: copy.subject, html: renderHtml(copy), text: renderText(copy) };
}
