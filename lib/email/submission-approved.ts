import { sendEmail, type SendEmailResult } from "./client";

export interface ApprovedEmailArgs {
  email: string;
  artistName: string;
  trackTitle: string | null;
  durationSeconds: number | null;
  airingPreference: "one_off" | "permanent";
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

export async function sendSubmissionApprovedEmail(
  args: ApprovedEmailArgs,
): Promise<SendEmailResult> {
  const title = args.trackTitle?.trim() || "your track";
  const dur = fmtDuration(args.durationSeconds);
  const trackLine = dur
    ? `${title} (${dur}, ${args.airingPreference === "permanent" ? "permanent rotation" : "one-off play"})`
    : `${title} (${args.airingPreference === "permanent" ? "permanent rotation" : "one-off play"})`;

  const subject = `🎉 Your track is on Numa Radio — ${args.artistName}`;

  const text = `GOOD NEWS 🎉

Hi ${args.artistName},

We listened to ${trackLine} and we're adding it to the station. It'll start playing on rotation soon — could be tonight, could be later this week, depending on what's already in the queue.

Tune in at https://numaradio.com — when your track airs, your name shows up on the live feed for everyone tuned in.

Thanks for sending it our way. Send us more whenever you've got something new.

— Numa Radio
https://numaradio.com
`;

  const safeArtist = escapeHtml(args.artistName);
  const safeTrack = escapeHtml(trackLine);

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #0f7d7a; margin: 0 0 14px;">🎉 Good news</p>
  <p>Hi ${safeArtist},</p>
  <p>We listened to <strong>${safeTrack}</strong> and we're adding it to the station. It'll start playing on rotation soon — could be tonight, could be later this week, depending on what's already in the queue.</p>
  <p>Tune in at <a href="https://numaradio.com" style="color:#0f7d7a;">numaradio.com</a> — when your track airs, your name shows up on the live feed for everyone tuned in.</p>
  <p>Thanks for sending it our way. Send us more whenever you've got something new.</p>
  <p style="margin-top: 28px;">— Numa Radio<br>
  <a href="https://numaradio.com" style="color:#0f7d7a;">numaradio.com</a></p>
</body></html>`;

  return sendEmail({ to: args.email, subject, html, text });
}
