"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlayIcon, PauseIcon, ImageIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { ArtworkPreview } from "@/components/ui/artwork-preview";
import { fmtRelative } from "@/lib/fmt";
import type { LibraryTrack } from "@/lib/library";
import { SubmissionsPanel } from "./SubmissionsPanel";
import { UpcomingQueue } from "@/components/upcoming-queue";
import { LibraryPreviewBar } from "@/components/library-preview-bar";
import type { PreviewSource } from "@/lib/preview-source";
import type {
  DaemonFailure,
  DaemonPush,
  DaemonStatusResponse,
} from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────

interface TracksResponse {
  tracks: LibraryTrack[];
  error?: string;
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

function showLabelFor(show: string | null): string {
  if (!show) return "—";
  return show.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
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
    f.reason.startsWith("listener_song_announce_") ||
    f.reason.startsWith("world_aside_") ||
    f.reason.startsWith("context_line_")
  );
}

async function setTrackShow(trackId: string, show: string) {
  const res = await fetch(`/api/library/track/${trackId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ show }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  }
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

const SHOW_OPTIONS: { value: string; label: string }[] = [
  { value: "night_shift", label: "Night Shift" },
  { value: "morning_room", label: "Morning Room" },
  { value: "daylight_channel", label: "Daylight Channel" },
  { value: "prime_hours", label: "Prime Hours" },
];

function ShowCell({ track, onChange }: { track: LibraryTrack; onChange: () => void }) {
  const [pending, setPending] = useState(false);
  async function set(next: string) {
    setPending(true);
    try {
      await setTrackShow(track.id, next);
      toast.success(`Show set: ${showLabelFor(next)}`);
      onChange();
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setPending(false);
    }
  }
  return (
    <Select
      value={track.show ?? ""}
      onValueChange={(v) => { if (typeof v === "string" && v) void set(v); }}
      disabled={pending}
    >
      <SelectTrigger
        size="sm"
        className="h-7 text-xs font-mono w-[140px] disabled:opacity-50"
      >
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {SHOW_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs font-mono">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Action icon button ────────────────────────────────────────────

function ActionIcon({
  onClick, disabled, title, tone, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  tone: "accent" | "muted" | "bad";
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "accent"
      ? "text-fg-mute hover:text-accent hover:border-accent/60 hover:bg-[var(--accent-soft)]"
      : tone === "bad"
        ? "text-fg-mute hover:text-[var(--bad)] hover:border-[var(--bad)]/60 hover:bg-[var(--bad)]/10"
        : "text-fg-mute hover:text-fg hover:border-fg-mute hover:bg-bg/60";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-8 h-8 inline-flex items-center justify-center border border-line rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${toneCls}`}
    >
      {children}
    </button>
  );
}

// ─── Component ─────────────────────────────────────────────────────

const PAGE_SIZE = 10;

// Shoutouts live in the Track table too (sourceType='external_import')
// but operators shouldn't see them in the music library by default.
function isShoutout(t: LibraryTrack): boolean {
  // Shoutouts are minted by dashboard/lib/shoutout.ts which ALWAYS
  // prefixes the title with "Shoutout" (see line ~213 — either
  // "Shoutout: <snippet>…" or bare "Shoutout"). Music submissions
  // never have that prefix — they use the artist-supplied trackTitle.
  // Combining the prefix check with the external_import + request_only
  // tuple keeps a real shoutout hidden while letting one-off music
  // submissions (also external_import + request_only since the recent
  // approve-mapping fix) show up in the library.
  return (
    t.sourceType === "external_import" &&
    t.airingPolicy === "request_only" &&
    t.title.startsWith("Shoutout")
  );
}

export default function LibraryPage() {
  const tracksPoll = usePolling<TracksResponse>("/api/library/tracks", 30_000);
  const pushesPoll = usePolling<DaemonStatusResponse>(
    "/api/library/recent-pushes",
    5_000,
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  // In-page preview: one shared <audio> element drives the bottom bar
  // for both library tracks AND submissions panel — only one preview
  // plays at a time across the whole page. Source is identified by an
  // opaque key like `track:<id>` or `submission:<id>` so SubmissionsPanel
  // can hook in without colliding with library track ids.
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function playPreview(src: PreviewSource | null) {
    const audio = audioRef.current;
    if (!audio) return;
    if (src === null || preview?.key === src?.key) {
      audio.pause();
      audio.currentTime = 0;
      setPreview(null);
      return;
    }
    audio.src = src.audioUrl;
    audio.currentTime = 0;
    audio.play().then(() => setPreview(src)).catch((err) => {
      toast.error(`Preview failed: ${err.message ?? err}`);
      setPreview(null);
    });
  }

  function togglePreview(track: LibraryTrack) {
    if (!track.audioStreamUrl) return;
    playPreview({
      key: `track:${track.id}`,
      title: track.title,
      artist: track.artist,
      artworkUrl: track.artworkUrl,
      audioUrl: track.audioStreamUrl,
    });
  }
  const [regenTarget, setRegenTarget] = useState<LibraryTrack | null>(null);
  const [regenHint, setRegenHint] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<LibraryTrack | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteTrack(t: LibraryTrack) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/library/track/${t.id}/delete`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) {
        toast.error(`Delete failed: ${j.error ?? res.status}`);
        return;
      }
      toast.success(`Deleted "${t.title}" — ${j.assetsDeletedFromB2 ?? 0} B2 file(s) removed${j.b2Failures ? ` (${j.b2Failures} failed)` : ""}`);
      setDeleteTarget(null);
      // Stop preview if it was the deleted track
      if (preview?.key === `track:${t.id}`) {
        const audio = audioRef.current;
        if (audio) { audio.pause(); audio.currentTime = 0; }
        setPreview(null);
      }
      tracksPoll.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setDeleting(false);
    }
  }

  const tracks = tracksPoll.data?.tracks ?? [];

  // Shoutouts are deleted from the DB by /api/internal/shoutout-ended
  // immediately after they air, so the library should rarely see one.
  // Still filter them defensively in case a cleanup failed or a row is
  // mid-flight.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks.filter((t) => {
      if (isShoutout(t)) return false;
      if (statusFilter !== "all" && categoriseStatus(t.trackStatus) !== statusFilter) return false;
      if (q) {
        const hay = `${t.title} ${t.artist ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Server already returns newest-first (ORDER BY createdAt DESC).
  }, [tracks, search, statusFilter]);

  // Reset to page 0 whenever the filtered set changes — prevents the
  // operator from being stuck on an out-of-range page after typing a
  // search or flipping a filter.
  const filteredKey = `${search}|${statusFilter}|${tracks.length}`;
  useEffect(() => {
    setPage(0);
  }, [filteredKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageTracks = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filtered, safePage],
  );

  const musicPushes = useMemo(
    () => (pushesPoll.data?.lastPushes ?? []).filter((p) => !isVoicePush(p)),
    [pushesPoll.data],
  );
  const musicFailures = useMemo(
    () => (pushesPoll.data?.lastFailures ?? []).filter((f) => !isVoiceFailure(f)),
    [pushesPoll.data],
  );

  async function regenerateArtwork(track: LibraryTrack, hint: string) {
    setRegenerating((prev) => { const n = new Set(prev); n.add(track.id); return n; });
    try {
      const res = await fetch(`/api/library/track/${track.id}/artwork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hint: hint.trim() || undefined }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success(`New artwork — "${track.title}"`);
      await tracksPoll.refresh();
    } catch (err) {
      toast.error(`Regenerate failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegenerating((prev) => { const n = new Set(prev); n.delete(track.id); return n; });
    }
  }

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
    <main className="mx-auto w-full max-w-[1440px] px-4 py-6 flex flex-col gap-5 sm:gap-6 sm:px-6 sm:py-8">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex flex-col gap-1">
        <h1
          className="font-display text-3xl font-extrabold uppercase tracking-wide text-fg"
          style={{ fontStretch: "115%" }}
        >
          Library
        </h1>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          {tracks.length} tracks · {filtered.length} shown · {musicPushes.length} recent pushes
          {tracksPoll.isStale ? " · ⚠ stale" : ""}
        </span>
      </header>

      {/* ── Music submissions panel ───────────────────────── */}
      <SubmissionsPanel
        onPreview={playPreview}
        activePreviewKey={preview?.key ?? null}
      />

      {/* ── Up Next: drag-and-drop rotation override ──────── */}
      <UpcomingQueue />

      {/* ── Sticky control bar: search + filter chips ──────── */}
      <div className="sticky top-14 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-bg/95 backdrop-blur border-b border-line flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or artist…"
          aria-label="Search tracks by title or artist"
          className="w-full sm:flex-1 sm:min-w-[200px] bg-transparent border border-line rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-accent"
        />
        <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Status filter">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              aria-pressed={statusFilter === f}
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
              <>
              {/* Mobile card list — below md only. Same data as the
                  desktop table, but vertical rhythm with touch-friendly
                  hit targets. Artwork left, title/meta middle, Play Next
                  right. */}
              <ul className="divide-y divide-line md:hidden">
                {pageTracks.map((t) => {
                  const disabled = !t.audioStreamUrl || pendingId === t.id;
                  return (
                    <li
                      key={t.id}
                      className="flex items-center gap-3 px-3 py-3"
                    >
                      {t.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.artworkUrl}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-md bg-bg-1 object-cover shadow-sm shadow-black/40"
                        />
                      ) : (
                        <div className="h-12 w-12 shrink-0 rounded-md border border-line bg-bg" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {t.title}
                        </div>
                        <div className="truncate text-xs text-fg-mute">
                          {t.artist ?? "—"}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-mute">
                          <span className="tabular-nums">
                            {fmtDuration(t.durationSeconds)}
                          </span>
                          {t.genre && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="truncate normal-case tracking-normal">
                                {t.genre}
                              </span>
                            </>
                          )}
                          <span aria-hidden>·</span>
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(t.trackStatus)}
                          >
                            {t.trackStatus}
                          </Badge>
                          {t.show && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="truncate normal-case tracking-normal">
                                {showLabelFor(t.show)}
                              </span>
                            </>
                          )}
                          {(t.votesUp > 0 || t.votesDown > 0) && (
                            <span className="tabular-nums">
                              <span
                                className={
                                  t.votesUp > 0 ? "text-accent" : ""
                                }
                              >
                                ▲{t.votesUp}
                              </span>{" "}
                              <span
                                className={
                                  t.votesDown > 0
                                    ? "text-[var(--bad)]"
                                    : ""
                                }
                              >
                                ▼{t.votesDown}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={disabled}
                        onClick={() => pushTrack(t)}
                        className="shrink-0"
                        title={
                          !t.audioStreamUrl
                            ? "No audio asset"
                            : "Push to priority queue"
                        }
                      >
                        {pendingId === t.id ? "…" : "Play"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {/* Desktop table — md and up. Each meta field gets its own column
                  so duration, genre, and votes don't collide. Two icon buttons
                  per row for the two common actions (Play next, Regenerate
                  artwork) — fewer clicks than a dropdown for the actions
                  the operator uses every time. */}
              <div className="hidden md:block">
                {/* table-fixed enforces the column widths declared on the
                    <th> cells; without it, an extremely long track title
                    blows the Track column wide, pushing the artwork
                    column out of place. */}
                <table className="w-full text-sm table-fixed">
                  <thead className="sticky top-0 bg-bg-1 z-[1] border-b border-line">
                    <tr className="text-fg-mute font-mono text-[10px] uppercase tracking-[0.2em]">
                      <th className="text-left px-4 py-2.5 w-[88px]"></th>
                      <th className="text-left px-2 py-2.5">Track</th>
                      <th className="text-center px-2 py-2.5 w-[44px]">Preview</th>
                      <th className="text-right px-3 py-2.5 w-[64px]">Time</th>
                      <th className="text-left px-3 py-2.5 w-[140px]">Genre</th>
                      <th className="text-right px-3 py-2.5 w-[90px]">Votes</th>
                      <th className="text-left px-3 py-2.5 w-[160px]">Show</th>
                      <th className="text-right px-4 py-2.5 w-[100px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageTracks.map((t) => {
                      const playable = !!t.audioStreamUrl;
                      const isPending = pendingId === t.id;
                      const isRegen = regenerating.has(t.id);
                      const statusCat = categoriseStatus(t.trackStatus);
                      return (
                        <tr
                          key={t.id}
                          className="border-t border-line align-middle hover:bg-bg/40 transition-colors"
                        >
                          {/* Cover + tiny status indicator dot */}
                          <td className="px-4 py-3">
                            <ArtworkPreview
                              src={t.artworkUrl}
                              alt={t.title}
                              previewSize={280}
                              thumbClassName={`block w-14 h-14 rounded-md object-cover bg-bg-1 shadow-sm shadow-black/40 transition-opacity ${isRegen ? "opacity-30" : ""}`}
                            >
                              {isRegen && (
                                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                  <Loader2Icon size={20} className="animate-spin text-accent" />
                                </span>
                              )}
                              {!isRegen && statusCat !== "ready" && (
                                <span
                                  title={`Status: ${t.trackStatus}`}
                                  className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-bg-1 pointer-events-none ${
                                    statusCat === "failed" ? "bg-[var(--bad)]" :
                                    statusCat === "draft" ? "bg-[var(--warn)]" :
                                    "bg-fg-mute"
                                  }`}
                                />
                              )}
                            </ArtworkPreview>
                          </td>

                          {/* Title + artist stacked */}
                          <td className="px-2 py-3 min-w-0">
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium text-fg truncate" title={t.title}>
                                {t.title}
                              </span>
                              <span className="text-xs text-fg-mute font-mono truncate" title={t.artist ?? ""}>
                                {t.artist ?? "—"}
                              </span>
                            </div>
                          </td>

                          {/* Preview — in-page audio toggle */}
                          <td className="px-2 py-3 text-center">
                            {(() => {
                              const isPreviewing = preview?.key === `track:${t.id}`;
                              return (
                                <ActionIcon
                                  onClick={() => togglePreview(t)}
                                  disabled={!t.audioStreamUrl}
                                  title={
                                    !t.audioStreamUrl ? "No audio asset"
                                    : isPreviewing ? "Pause preview"
                                    : "Preview"
                                  }
                                  tone={isPreviewing ? "accent" : "muted"}
                                >
                                  {isPreviewing
                                    ? <PauseIcon size={15} strokeWidth={2} />
                                    : <PlayIcon size={15} strokeWidth={2} />}
                                </ActionIcon>
                              );
                            })()}
                          </td>

                          {/* Time */}
                          <td className="px-3 py-3 text-right text-xs text-fg-mute font-mono tabular-nums whitespace-nowrap">
                            {fmtDuration(t.durationSeconds)}
                          </td>

                          {/* Genre */}
                          <td className="px-3 py-3 text-xs text-fg-mute font-mono">
                            <span className="block truncate" title={t.genre ?? ""}>
                              {t.genre ?? "—"}
                            </span>
                          </td>

                          {/* Votes */}
                          <td className="px-3 py-3 text-right text-xs font-mono tabular-nums whitespace-nowrap">
                            <span className={t.votesUp > 0 ? "text-accent" : "text-fg-mute"}>
                              ▲ {t.votesUp}
                            </span>
                            <span className="inline-block w-2.5" />
                            <span className={t.votesDown > 0 ? "text-[var(--bad)]" : "text-fg-mute"}>
                              ▼ {t.votesDown}
                            </span>
                          </td>

                          {/* Show selector */}
                          <td className="px-3 py-3">
                            <ShowCell track={t} onChange={() => tracksPoll.refresh()} />
                          </td>

                          {/* Action icons — Play next + Regenerate artwork */}
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <ActionIcon
                                onClick={() => pushTrack(t)}
                                disabled={!playable || isPending || isRegen}
                                title={!playable ? "No audio asset" : isPending ? "Pushing…" : "Play next"}
                                tone="accent"
                              >
                                <PlayIcon size={15} strokeWidth={2} />
                              </ActionIcon>
                              {(() => {
                                // Lock the regen action when the artist
                                // supplied their own art (uploaded a file
                                // or embedded it in the MP3) so an
                                // accidental click can't wipe their work.
                                const artistArt = t.artworkSource === "upload" || t.artworkSource === "id3";
                                return (
                                  <ActionIcon
                                    onClick={() => { setRegenTarget(t); setRegenHint(""); }}
                                    disabled={isRegen || isPending || artistArt}
                                    title={
                                      artistArt
                                        ? "Artist-supplied artwork — regenerate disabled"
                                        : isRegen
                                          ? "Regenerating…"
                                          : "Regenerate artwork"
                                    }
                                    tone="muted"
                                  >
                                    {isRegen
                                      ? <Loader2Icon size={15} className="animate-spin" />
                                      : <ImageIcon size={15} strokeWidth={2} />}
                                  </ActionIcon>
                                );
                              })()}
                              <ActionIcon
                                onClick={() => setDeleteTarget(t)}
                                disabled={isRegen || isPending || deleting}
                                title="Delete track (DB + B2)"
                                tone="bad"
                              >
                                <Trash2Icon size={15} strokeWidth={2} />
                              </ActionIcon>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
            {/* Pagination footer — only shown when we have more than one page. */}
            {filtered.length > PAGE_SIZE && (
              <div className="border-t border-line px-4 py-2.5 flex items-center justify-between gap-3 font-mono text-[11px] text-fg-mute">
                <span>
                  {safePage * PAGE_SIZE + 1}–
                  {Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of{" "}
                  {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="px-2.5 py-1 rounded border border-line text-fg-mute hover:text-fg hover:border-fg-mute disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    ← Prev
                  </button>
                  <span className="px-2 uppercase tracking-[0.15em]">
                    page {safePage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    className="px-2.5 py-1 rounded border border-line text-fg-mute hover:text-fg hover:border-fg-mute disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    Next →
                  </button>
                </div>
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
                        {fmtRelative(p.at)}
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
                          {fmtRelative(f.at)}
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

      {/* Regenerate-artwork confirmation dialog */}
      <Dialog open={!!regenTarget} onOpenChange={(o) => { if (!o) setRegenTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate artwork</DialogTitle>
            <DialogDescription>
              Replaces the cover for <span className="text-fg font-medium">"{regenTarget?.title}"</span>{" "}
              with a fresh FLUX Pro generation. Existing cover is deleted from B2.
              Track playback isn't affected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <label className="text-[11px] uppercase tracking-[0.18em] text-fg-mute font-mono">
              Operator note (optional)
            </label>
            <textarea
              value={regenHint}
              onChange={(e) => setRegenHint(e.target.value)}
              placeholder="e.g. abstract sunrise over an empty highway, no people"
              rows={3}
              className="bg-bg border border-line rounded px-3 py-2 text-sm font-mono outline-none focus:border-accent resize-y placeholder:text-fg-mute/50"
            />
            <span className="text-xs text-fg-mute">
              Track metadata (title, mood, genre, show) is always sent. Add this only if the
              defaults aren't producing what you want.
            </span>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!regenTarget) return;
                const t = regenTarget;
                setRegenTarget(null);
                void regenerateArtwork(t, regenHint);
              }}
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Delete-track confirmation dialog. Calls /api/library/track/:id/delete
          which proxies to the public site's internal delete (Prisma + B2 cleanup).
          Drops the Track row, all TrackAssets + B2 files, QueueItems, TrackVotes,
          BroadcastSegments. Nulls trackId on PlayHistory + SongRequest +
          MusicSubmission to preserve audit. */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[var(--bad)]">Delete this track forever?</DialogTitle>
            <DialogDescription>
              <span className="text-fg font-medium">"{deleteTarget?.title}"</span>{deleteTarget?.artist ? <> by <span className="text-fg">{deleteTarget.artist}</span></> : null}{" "}
              will be removed from rotation immediately. The audio file and artwork are deleted from B2,
              the Track row is removed from the database, and all queue items + votes are cleared.
              Play-history rows are kept (with the track link nulled) so historical counts survive.
              <br /><br />
              <span className="text-[var(--warn)]">This can't be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>No, keep it</Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => { if (deleteTarget) void deleteTrack(deleteTarget); }}
            >
              {deleting ? "Deleting…" : "Yes, delete forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shared preview audio. Hidden — togglePreview controls it via ref.
          onEnded clears the row's playing state so the icon flips back to
          Play when the track finishes naturally. */}
      <audio ref={audioRef} onEnded={() => setPreview(null)} preload="none" />

      {/* Floating preview bar with scrub slider — visible whenever a row is
          selected for preview (regardless of paused state). Adds bottom
          padding to the main content so the bar doesn't cover the last row. */}
      {preview ? (
        <>
          <div className="h-20" aria-hidden />
          <LibraryPreviewBar
            audioRef={audioRef}
            trackTitle={preview.title}
            trackArtist={preview.artist}
            artworkUrl={preview.artworkUrl}
            onTogglePlay={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (audio.paused) audio.play().catch(() => undefined);
              else audio.pause();
            }}
            onClose={() => {
              const audio = audioRef.current;
              if (audio) { audio.pause(); audio.currentTime = 0; }
              setPreview(null);
            }}
          />
        </>
      ) : null}
    </main>
  );
}
