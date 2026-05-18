// Newsletter template — placeholder for future bulk sends.
//
// No send route exists yet. When you build one:
//   1. Read opt-ins from `MusicSubmission.newsletterOptIn = true`
//      (dedupe by email — same artist may have submitted twice).
//   2. For each recipient, mint a signed unsubscribe URL (HMAC pattern
//      mirrors `lib/sign-audio-url.ts` — sign `{email, exp}` with
//      INTERNAL_API_SECRET, verify on the unsubscribe route).
//   3. Pass that URL to `renderNewsletter()` to get html/text.
//   4. Send via `sendEmail()` — and at send time, ALSO add a
//      `List-Unsubscribe: <unsubscribeUrl>` header (RFC 8058) so Gmail
//      / Outlook / Apple Mail render their native one-click unsubscribe
//      button. The current `sendEmail()` wrapper doesn't accept custom
//      headers; extend `lib/email/client.ts` minimally when you wire
//      this up.
//
// GDPR baseline: explicit opt-in via the submit form (already done) +
// per-email unsubscribe (the link this template renders + the
// List-Unsubscribe header at send time). Don't ship a newsletter
// without both.

import { sendEmail, type SendEmailResult } from "./client";

export interface NewsletterArgs {
  email: string;
  /** Recipient's display name for the greeting. Empty string → drops the
   *  "Hi X," line entirely (cleaner than "Hi ,"). */
  recipientName: string;
  /** Subject line — keep under 60 chars for full-display on mobile. */
  subject: string;
  /** Small eyebrow line above the headline, mono uppercase teal.
   *  e.g. "📻 May edition" or "🆕 New on the station". */
  eyebrow: string;
  /** The bold headline that sits under the eyebrow. */
  headline: string;
  /** Body paragraphs in order. Each entry becomes a `<p>` in HTML and a
   *  blank-line-separated block in text. Keep punchy — the host voice
   *  is short and warm, never corporate. */
  paragraphs: string[];
  /** Signed one-click unsubscribe URL (see file header). */
  unsubscribeUrl: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderNewsletter(args: NewsletterArgs): { html: string; text: string } {
  const greetText = args.recipientName.trim() ? `Hi ${args.recipientName.trim()},\n\n` : "";
  const bodyText = args.paragraphs.join("\n\n");

  const text = `${args.eyebrow}

${args.headline}

${greetText}${bodyText}

— Numa Radio
https://numaradio.com

You're getting this because you opted in when submitting music to Numa Radio. Unsubscribe any time: ${args.unsubscribeUrl}
`;

  const safeName = escapeHtml(args.recipientName.trim());
  const safeEyebrow = escapeHtml(args.eyebrow);
  const safeHeadline = escapeHtml(args.headline);
  const safeUnsub = escapeHtml(args.unsubscribeUrl);
  const safeParagraphs = args.paragraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n  ");
  const greetingHtml = safeName ? `<p>Hi ${safeName},</p>\n  ` : "";

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #0f7d7a; margin: 0 0 14px;">${safeEyebrow}</p>
  <p style="font-size: 20px; font-weight: 700; line-height: 1.3; margin: 0 0 18px; color: #1a1a1a;">${safeHeadline}</p>
  ${greetingHtml}${safeParagraphs}
  <p style="margin-top: 28px;">— Numa Radio<br>
  <a href="https://numaradio.com" style="color:#0f7d7a;">numaradio.com</a></p>
  <hr style="border: none; border-top: 1px solid #e6e6e6; margin: 32px 0 16px;">
  <p style="font-size: 11px; color: #777; line-height: 1.5;">
    You're getting this because you opted in when submitting music to Numa Radio.<br>
    <a href="${safeUnsub}" style="color:#777; text-decoration: underline;">Unsubscribe</a>
  </p>
</body></html>`;

  return { html, text };
}

export async function sendNewsletter(args: NewsletterArgs): Promise<SendEmailResult> {
  const { html, text } = renderNewsletter(args);
  return sendEmail({ to: args.email, subject: args.subject, html, text });
}
