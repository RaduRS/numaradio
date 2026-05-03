import { sendEmail, type SendEmailResult } from "./client";

export interface RejectedEmailArgs {
  email: string;
  artistName: string;
  trackTitle: string | null;
  durationSeconds: number | null;
  airingPreference: "one_off" | "permanent";
  submittedAt: Date;
  reason: string;
}

function fmtDuration(s: number | null): string | null {
  if (s == null || s <= 0) return null;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendSubmissionRejectedEmail(
  args: RejectedEmailArgs,
): Promise<SendEmailResult> {
  const title = args.trackTitle?.trim() || "your track";
  const dur = fmtDuration(args.durationSeconds);
  const trackLine = dur
    ? `${title} (${dur}, ${args.airingPreference === "permanent" ? "permanent rotation" : "one-off play"})`
    : `${title} (${args.airingPreference === "permanent" ? "permanent rotation" : "one-off play"})`;
  const dateStr = args.submittedAt.toISOString().slice(0, 10);

  const subject = `Re: your submission to Numa Radio — ${args.artistName}`;

  const text = `Hi ${args.artistName},

Thanks for sending us ${trackLine} on ${dateStr}. We listened through and unfortunately won't be adding it to Numa Radio at this time.

Reason: ${args.reason}

We appreciate you sharing your work and welcome future submissions.

— Numa Radio
https://numaradio.com
`;

  const safeArtist = escapeHtml(args.artistName);
  const safeTrack = escapeHtml(trackLine);
  const safeReason = escapeHtml(args.reason);

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hi ${safeArtist},</p>
  <p>Thanks for sending us <strong>${safeTrack}</strong> on ${dateStr}. We listened through and unfortunately won't be adding it to Numa Radio at this time.</p>
  <p><strong>Reason:</strong> ${safeReason}</p>
  <p>We appreciate you sharing your work and welcome future submissions.</p>
  <p style="margin-top: 28px;">— Numa Radio<br>
  <a href="https://numaradio.com" style="color:#0f7d7a;">numaradio.com</a></p>
</body></html>`;

  return sendEmail({ to: args.email, subject, html, text });
}
