/**
 * Relative time formatter shared across dashboard cards. Supersedes the
 * three near-duplicates that used to live in shoutouts/page.tsx,
 * library/page.tsx, and held-shoutouts-card.tsx.
 *
 * Output ladder:
 *   <5s      → "just now"
 *   <1m      → "Ns ago"
 *   <1h      → "Nm ago"
 *   <24h     → "Nh ago"
 *   older    → "MMM dd" (e.g. "Apr 25")
 *   missing  → "—"
 */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
