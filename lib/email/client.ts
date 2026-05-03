// Resend client + small helper used by the submission approve/reject
// internal routes. Lazy-init so a missing key at import time doesn't
// crash unrelated routes — sends just no-op + log instead.

import { Resend } from "resend";

const FROM = "Numa Radio <hello@numaradio.com>";
const REPLY_TO = "hello@numaradio.com";

let cached: Resend | null = null;
function client(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const c = client();
  if (!c) {
    console.warn("[email] RESEND_API_KEY missing — skipping send to", args.to);
    return { ok: false, skipped: true, error: "no_api_key" };
  }
  try {
    const r = await c.emails.send({
      from: FROM,
      to: args.to,
      replyTo: REPLY_TO,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (r.error) {
      console.error("[email] send failed:", r.error);
      return { ok: false, error: String(r.error.message ?? r.error) };
    }
    return { ok: true, id: r.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] send threw:", msg);
    return { ok: false, error: msg };
  }
}
