import { sendEmail, type SendEmailResult } from "./client";

export interface TermsUpdateEmailArgs {
  email: string;
  artistName: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendTermsUpdateEmail(
  args: TermsUpdateEmailArgs,
): Promise<SendEmailResult> {
  const subject = "Numa Radio — small terms update";

  const text = `Hi ${args.artistName},

One small update on our submission terms. The full version is at numaradio.com/privacy — here's the plain-English bit that changed:

Before: we could broadcast your track on the 24/7 audio stream and the YouTube Live simulcast.

Added:  we can also use it in promotional clips on our social media (TikTok, Instagram Reels, YouTube Shorts, X). Your artist name and track title may appear on screen.

Why we're telling you: we're about to start posting these clips to promote the station, and we wanted you to hear it from us first.

If you'd rather we don't include your tracks in those posts, just reply to this email and we'll leave you out — no problem at all.

Thanks for being on Numa.

— Numa Radio
hello@numaradio.com  ·  https://numaradio.com
`;

  const safeArtist = escapeHtml(args.artistName);

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hi ${safeArtist},</p>
  <p>One small update on our submission terms. The full version is at <a href="https://numaradio.com/privacy" style="color:#0f7d7a;">numaradio.com/privacy</a> — here's the plain-English bit that changed:</p>
  <p style="margin: 18px 0;"><strong>Before:</strong> we could broadcast your track on the 24/7 audio stream and the YouTube Live simulcast.</p>
  <p style="margin: 18px 0;"><strong>Added:</strong> we can also use it in promotional clips on our social media (TikTok, Instagram Reels, YouTube Shorts, X). Your artist name and track title may appear on screen.</p>
  <p><strong>Why we're telling you:</strong> we're about to start posting these clips to promote the station, and we wanted you to hear it from us first.</p>
  <p>If you'd rather we don't include your tracks in those posts, just reply to this email and we'll leave you out — no problem at all.</p>
  <p>Thanks for being on Numa.</p>
  <p style="margin-top: 28px;">— Numa Radio<br>
  <a href="mailto:hello@numaradio.com" style="color:#0f7d7a;">hello@numaradio.com</a>  ·  <a href="https://numaradio.com" style="color:#0f7d7a;">numaradio.com</a></p>
</body></html>`;

  return sendEmail({ to: args.email, subject, html, text });
}
