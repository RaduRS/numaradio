"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LibraryTrack } from "@/lib/library";

// ─── Types ─────────────────────────────────────────────────────────

interface TracksResponse {
  tracks: LibraryTrack[];
  error?: string;
}

// Matches the daemon's ring-buffer shape as actually emitted by
// workers/queue-daemon/index.ts: { at, trackId, url, script? } for
// pushes and { at, reason, detail? } for failures. The fields are
// optional because the buffer's schema predates some of them.
interface DaemonPush {
  at?: string;
  trackId?: string;
  url?: string;
  script?: string;
}
interface DaemonFailure {
  at?: string;
  reason?: string;
  detail?: string;
}
interface DaemonStatusResponse {
  lastPushes: DaemonPush[];
  lastFailures: DaemonFailure[];
}

type StatusFilter = "all" | "ready" | "draft" | "failed" | "other";
const STATUS_FILTERS: StatusFilter[] = ["all", "ready", "draft", "failed", "other"];

// ─── Utilities ─────────────────────────────────────────────────────

function fmtDuration(sec: number | null): string {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function statusBadgeClass(status: string): string {
  if (status === "ready") return "border-accent text-accent bg-[var(--accent-soft)]";
  if (status === "draft") return "border-[var(--warn)] text-[var(--warn)]";
  if (status === "failed") return "border-[var(--bad)] text-[var(--bad)]";
  return "border-line text-fg-mute";
}

function categoriseStatus(s: string): StatusFilter {
  if (s === "ready" || s === "draft" || s === "failed") return s;
  return "other";
}

/**
 * Voice-related entries (auto-chatter and listener-song announcements)
 * live on /shoutouts. /library only surfaces genuine MUSIC push activity:
 *   - operator Play-Next pushes from this page (trackId = a real Track id)
 *   - song-worker pushes of freshly-generated listener songs (same)
 *   - generic socket/queue failures that affect music playback
 */
function isVoicePush(p: DaemonPush): boolean {
  if (!p.trackId) return false;
  return (
    p.trackId.startsWith("auto-chatter:") ||
    p.trackId.startsWith("announce:")
  );
}
function isVoiceFailure(f: DaemonFailure): boolean {
  if (!f.reason) return false;
  return (
    f.reason.startsWith("auto_chatter_") ||
    f.reason.startsWith("listener_song_announce_")
  );
}

// Extract the MP3 filename or fall back to the trackId tail — useful
// for quickly identifying a push when rows scroll past.
function labelFor(entry: DaemonPush): string {
  if (entry.url) {
    const last = entry.url.split("/").pop();
    if (last) return last;
  }
  return entry.trackId ?? "(unknown)";
}

// ─── Component ─────────────────────────────────────────────────────

export default function LibraryPage() {
  const tracksPoll = usePolling<TracksResponse>("/api/library/tracks", 30_000);
  const pushesPoll = usePolling<DaemonStatusResponse>(
    "/api/library/recent-pushes",
    5_000,
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const tracks = tracksPoll.data?.tracks ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks.filter((t) => {
      if (statusFilter !== "all" && categoriseStatus(t.trackStatus) !== statusFilter) return false;
      if (q) {
        const hay = `${t.title} ${t.artist ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tracks, search, statusFilter]);

  const musicPushes = useMemo(
    () => (pushesPoll.data?.lastPushes ?? []).filter((p) => !isVoicePush(p)),
    [pushesPoll.data],
  );
  const musicFailures = useMemo(
    () => (pushesPoll.data?.lastFailures ?? []).filter((f) => !isVoiceFailure(f)),
    [pushesPoll.data],
  );

  async function pushTrack(track: LibraryTrack) {
    if (!track.audioStreamUrl) {
      toast.error(`No audio asset for "${track.title}"`);
      return;
    }
    setPendingId(track.id);
    try {
      const res = await fetch("/api/library/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId: track.id }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; title?: string };
      if (res.ok && json.ok) {
        toast.success(`Queued — ${json.title ?? track.title}`, {
          description: "Will play at the next track boundary.",
        });
        pushesPoll.refresh();
      } else {
        toast.error(`Failed to queue "${track.title}"`, {
          description: json.error ?? "unknown error",
        });
      }
    } catch (e) {
      toast.error(`Failed to queue "${track.title}"`, {
        description: e instanceof Error ? e.message : "network error",
      });
    } finally {
      setPendingId(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: tracks.length, ready: 0, draft: 0, failed: 0, other: 0 };
    for (const t of tracks) c[categoriseStatus(t.trackStatus)] += 1;
    return c;
  }, [tracks]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span
            className="font-display text-2xl font-extrabold uppercase tracking-wide"
            style={{ fontStretch: "125%" }}
          >
            Numa<span className="text-accent">·</span>Radio
          </span>
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute hover:text-fg"
          >
            ← Dashboard
          </Link>
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Library · {tracks.length} tracks · {musicPushes.length} recent pushes
          {tracksPoll.isStale ? " · ⚠ stale" : ""}
        </span>
      </header>

      {/* ── Sticky control bar: search + filter chips ──────── */}
      <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-bg/95 backdrop-blur border-b border-line flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or artist…"
          className="flex-1 min-w-[200px] bg-transparent border border-line rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-accent"
        />
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`font-mono text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border transition ${
                statusFilter === f
                  ? "border-accent text-accent bg-[var(--accent-soft)]"
                  : "border-line text-fg-mute hover:text-fg hover:border-fg-mute"
              }`}
            >
              {f} <span className="opacity-60">({counts[f]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main grid: Tracks // Recent pushes sidebar ─────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* LEFT ─ Tracks table */}
        <Card className="bg-bg-1 border-line min-w-0">
          <CardContent className="p-0">
            {tracksPoll.error ? (
              <div className="px-4 py-8 text-sm text-[var(--bad)]">
                Library unavailable — {tracksPoll.error}
              </div>
            ) : !tracksPoll.data ? (
              <div className="px-4 py-8 text-sm text-fg-mute">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-sm text-fg-mute">
                No tracks match. {tracks.length === 0 && "Library is empty."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-1 z-[1] border-b border-line">
                    <tr className="text-fg-mute font-mono text-[10px] uppercase tracking-[0.2em]">
                      <th className="text-left px-4 py-2.5 w-10"></th>
                      <th className="text-left px-2 py-2.5">Title</th>
                      <th className="text-left px-2 py-2.5">Artist</th>
                      <th className="text-right px-2 py-2.5 w-14">Time</th>
                      <th className="text-left px-2 py-2.5 w-20">Genre</th>
                      <th className="text-right px-2 py-2.5 w-20">Votes</th>
                      <th className="text-left px-2 py-2.5 w-16">Status</th>
                      <th className="text-right px-4 py-2.5 w-28"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => {
                      const disabled = !t.audioStreamUrl || pendingId === t.id;
                      return (
                        <tr
                          key={t.id}
                          className="border-t border-line align-middle hover:bg-bg/40 transition-colors"
                        >
                          <td className="px-4 py-2">
                            {t.artworkUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={t.artworkUrl}
                                alt=""
                                className="w-9 h-9 rounded object-cover bg-bg-1"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded bg-bg" />
                            )}
                          </td>
                          <td className="px-2 py-2 font-medium">{t.title}</td>
                          <td className="px-2 py-2 text-fg-mute">{t.artist ?? "—"}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs text-fg-mute tabular-nums">
                            {fmtDuration(t.durationSeconds)}
                          </td>
                          <td className="px-2 py-2 text-fg-mute text-xs">{t.genre ?? "—"}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                            <span className={t.votesUp > 0 ? "text-accent" : "text-fg-mute"}>
                              ▲ {t.votesUp}
                            </span>
                            <span className="mx-1.5 text-fg-mute opacity-50">·</span>
                            <span className={t.votesDown > 0 ? "text-[var(--bad)]" : "text-fg-mute"}>
                              ▼ {t.votesDown}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <Badge variant="outline" className={statusBadgeClass(t.trackStatus)}>
                              {t.trackStatus}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={disabled}
                              onClick={() => pushTrack(t)}
                              title={!t.audioStreamUrl ? "No audio asset" : "Push to priority queue"}
                            >
                              {pendingId === t.id ? "…" : "Play Next"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT ─ Recent pushes sidebar (music-only) */}
        <aside className="flex flex-col gap-4">
          <Card className="bg-bg-1 border-line">
            <CardHeader>
              <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
                Recent music pushes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!pushesPoll.data ? (
                <div className="px-4 py-6 text-sm text-fg-mute">Loading…</div>
              ) : musicPushes.length === 0 ? (
                <div className="px-4 py-6 text-sm text-fg-mute">
                  Nothing pushed recently. Click Play Next to queue a track.
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {musicPushes.slice(0, 10).map((p, i) => (
                    <li
                      key={`p${i}`}
                      className="px-4 py-2.5 flex items-start justify-between gap-3 border-l-2 border-l-[var(--accent-soft,transparent)]"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-mono text-[11px] truncate" title={labelFor(p)}>
                          {labelFor(p)}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-fg-mute shrink-0 pt-0.5">
                        {fmtRelativeTime(p.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="bg-bg-1 border-line">
            <CardHeader>
              <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
                Recent music failures
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!pushesPoll.data ? (
                <div className="px-4 py-6 text-sm text-fg-mute">Loading…</div>
              ) : musicFailures.length === 0 ? (
                <div className="px-4 py-6 text-sm text-fg-mute">
                  None. Voice-feature failures live on the Shoutouts page.
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {musicFailures.slice(0, 8).map((f, i) => (
                    <li
                      key={`f${i}`}
                      className="px-4 py-2.5 flex flex-col gap-0.5 border-l-2 border-l-[var(--bad)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-mono text-[11px] text-[var(--bad)] truncate">
                          ✗ {f.reason}
                        </span>
                        <span className="font-mono text-[10px] text-fg-mute shrink-0">
                          {fmtRelativeTime(f.at)}
                        </span>
                      </div>
                      {f.detail && (
                        <span
                          className="font-mono text-[10px] text-fg-mute truncate"
                          title={f.detail}
                        >
                          {f.detail.length > 80 ? f.detail.slice(0, 80) + "…" : f.detail}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="rounded-md border border-line bg-bg-1 px-3 py-3 text-[11px] text-fg-mute font-mono leading-relaxed">
            Auto-chatter &amp; announcement activity lives on the{" "}
            <Link href="/shoutouts" className="text-accent hover:underline">
              Shoutouts
            </Link>{" "}
            page.
          </div>
        </aside>
      </div>
    </main>
  );
}
