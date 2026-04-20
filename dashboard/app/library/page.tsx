"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LibraryTrack } from "@/lib/library";

interface TracksResponse {
  tracks: LibraryTrack[];
  error?: string;
}

interface RecentPushesResponse {
  lastPushes: Array<{
    queueItemId?: string;
    trackId?: string;
    sourceUrl?: string;
    reason?: string;
    pushedAt?: string;
    rid?: number | string;
  }>;
  lastFailures: Array<{
    trackId?: string;
    sourceUrl?: string;
    reason?: string;
    error?: string;
    failedAt?: string;
  }>;
}

type StatusFilter = "all" | "ready" | "draft" | "failed" | "other";
const STATUS_FILTERS: StatusFilter[] = ["all", "ready", "draft", "failed", "other"];

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
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
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

export default function LibraryPage() {
  const tracksPoll = usePolling<TracksResponse>("/api/library/tracks", 30_000);
  const pushesPoll = usePolling<RecentPushesResponse>("/api/library/recent-pushes", 5_000);

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
    <main className="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-8">
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
          Library · {tracks.length} tracks{tracksPoll.isStale ? " · ⚠ stale" : ""}
        </span>
      </header>

      <Card className="bg-bg-1 border-line">
        <CardHeader className="gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
              Tracks
            </CardTitle>
            <div className="flex items-center gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`font-mono text-[11px] uppercase tracking-[0.15em] px-2 py-1 rounded-full border transition ${
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
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or artist…"
            className="w-full bg-bg border border-line rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-accent"
          />
        </CardHeader>
        <CardContent className="p-0">
          {tracksPoll.error ? (
            <div className="px-4 py-6 text-sm text-[var(--bad)]">
              Library unavailable — {tracksPoll.error}
            </div>
          ) : !tracksPoll.data ? (
            <div className="px-4 py-6 text-sm text-fg-mute">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-sm text-fg-mute">
              No tracks match. {tracks.length === 0 && "Library is empty."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg-mute font-mono text-[11px] uppercase tracking-[0.15em]">
                    <th className="text-left px-4 py-2 w-10"></th>
                    <th className="text-left px-2 py-2">Title</th>
                    <th className="text-left px-2 py-2">Artist</th>
                    <th className="text-right px-2 py-2 w-16">Time</th>
                    <th className="text-left px-2 py-2 w-24">Genre</th>
                    <th className="text-right px-2 py-2 w-24">Votes</th>
                    <th className="text-left px-2 py-2 w-20">Status</th>
                    <th className="text-right px-4 py-2 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const disabled = !t.audioStreamUrl || pendingId === t.id;
                    return (
                      <tr key={t.id} className="border-t border-line align-middle">
                        <td className="px-4 py-2">
                          {t.artworkUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={t.artworkUrl}
                              alt=""
                              className="w-8 h-8 rounded object-cover bg-bg-1"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded bg-bg" />
                          )}
                        </td>
                        <td className="px-2 py-2 font-medium">{t.title}</td>
                        <td className="px-2 py-2 text-fg-mute">{t.artist ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono text-xs text-fg-mute">
                          {fmtDuration(t.durationSeconds)}
                        </td>
                        <td className="px-2 py-2 text-fg-mute text-xs">{t.genre ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                          <span
                            className={
                              t.votesUp > 0 ? "text-accent" : "text-fg-mute"
                            }
                          >
                            ▲ {t.votesUp}
                          </span>
                          <span className="mx-1.5 text-fg-mute opacity-50">·</span>
                          <span
                            className={
                              t.votesDown > 0
                                ? "text-[var(--bad)]"
                                : "text-fg-mute"
                            }
                          >
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

      <Card className="bg-bg-1 border-line">
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
            Recent priority pushes
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!pushesPoll.data ? (
            <div className="px-4 py-6 text-sm text-fg-mute">Loading…</div>
          ) : (pushesPoll.data.lastPushes.length === 0 && pushesPoll.data.lastFailures.length === 0) ? (
            <div className="px-4 py-6 text-sm text-fg-mute">
              Nothing pushed recently. Click Play Next on a track above.
            </div>
          ) : (
            <div className="divide-y divide-line">
              {pushesPoll.data.lastPushes.slice(0, 10).map((p, i) => (
                <div key={`p${i}`} className="px-4 py-2 flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="font-mono text-xs truncate">
                      {p.sourceUrl?.split("/").pop() ?? p.trackId ?? "(unknown)"}
                    </span>
                    {p.reason && (
                      <span className="font-mono text-[10px] text-fg-mute truncate">
                        reason: {p.reason}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-fg-mute shrink-0">
                    {fmtRelativeTime(p.pushedAt)}
                  </span>
                </div>
              ))}
              {pushesPoll.data.lastFailures.slice(0, 5).map((f, i) => (
                <div key={`f${i}`} className="px-4 py-2 flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="font-mono text-xs text-[var(--bad)] truncate">
                      ✗ {f.sourceUrl?.split("/").pop() ?? f.trackId ?? "(unknown)"}
                    </span>
                    {f.error && (
                      <span className="font-mono text-[10px] text-fg-mute truncate">
                        {f.error}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-fg-mute shrink-0">
                    {fmtRelativeTime(f.failedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
