// Validation + storage helpers shared by the public submission form
// and the operator approve/reject endpoints. Magic-byte sniffing here
// avoids trusting the multipart MIME header from the client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s: unknown): boolean {
  return typeof s === "string" && EMAIL_RE.test(s.trim()) && s.trim().length <= 254;
}

export function isValidName(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const t = s.trim();
  return t.length >= 2 && t.length <= 80;
}

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

export function normalizeName(s: string): string {
  return s.trim();
}

/**
 * MP3 magic-byte check. Tagged files start with ASCII "ID3"; raw MPEG
 * audio frames start with the 11-bit sync (0xFF followed by 0xFB / 0xF3
 * for MPEG-1/2 Layer III). Anything else gets rejected — we do not
 * trust the multipart MIME header from the browser.
 */
export function sniffMp3(buf: Buffer): boolean {
  if (buf.length < 3) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // 'ID3'
  if (buf[0] === 0xFF && (buf[1] === 0xFB || buf[1] === 0xF3 || buf[1] === 0xF2)) return true;
  return false;
}

export function sniffImage(buf: Buffer): "png" | "jpeg" | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "jpeg";
  return null;
}

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;  // 10 MB
export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024; //  2 MB

export function audioStorageKey(submissionId: string): string {
  return `submissions/${submissionId}.mp3`;
}

export function artworkStorageKey(submissionId: string, kind: "png" | "jpeg"): string {
  const ext = kind === "jpeg" ? "jpg" : "png";
  return `submissions/${submissionId}.${ext}`;
}
