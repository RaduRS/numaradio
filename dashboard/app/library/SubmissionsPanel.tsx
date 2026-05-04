"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PlayIcon, PauseIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PreviewSource } from "@/lib/preview-source";

type Pending = {
  id: string;
  artistName: string;
  trackTitle: string | null;
  trackGenre: string | null;
  email: string;
  airingPreference: "one_off" | "permanent";
  durationSeconds: number | null;
  artworkStorageKey: string | null;
  createdAt: string;
  /** Pre-signed by the dashboard's /api/submissions/list route. The
   *  signature expires after 1h; the public-site route 404s without
   *  it so random visitors can't stream pending unmoderated audio. */
  audioUrl: string;
};

type Reviewed = {
  id: string;
  artistName: string;
  trackTitle: string | null;
  trackGenre: string | null;
  email: string;
  airingPreference: "one_off" | "permanent";
  status: "approved" | "rejected" | "withdrawn";
  rejectReason: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

interface SubmissionsPanelProps {
  /** Called when the operator clicks Play on a pending row. Pass null to stop. */
  onPreview: (src: PreviewSource | null) => void;
  /** The currently-playing preview's key (or null). Used to flip Play↔Pause. */
  activePreviewKey: string | null;
}

type ListResponse = { pending: Pending[]; reviewed: Reviewed[] };

type SweepStatus = {
  lastRun: string | null;
  counts: {
    shoutoutsDeleted: number;
    songRequestsDeleted: number;
    rejectedSubmissionsDeleted: number;
  } | null;
};

/**
 * Compute the next 04:00 UTC after the given timestamp. Cron schedule
 * is "0 4 * * *" — daily at 04:00 UTC. Stay in sync with vercel.json.
 */
function nextSweepAt(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(4, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function fmtSweepIn(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms < 0) return "imminent";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

const SHOW_OPTIONS = [
  { value: "night_shift", label: "Night Shift · 00–05" },
  { value: "morning_room", label: "Morning Room · 05–10" },
  { value: "daylight_channel", label: "Daylight Channel · 10–17" },
  { value: "prime_hours", label: "Prime Hours · 17–24" },
] as const;
type ShowSlug = (typeof SHOW_OPTIONS)[number]["value"];

const REJECT_REASONS = [
  "Audio quality not radio-ready (mastering, distortion, low bitrate)",
  "Genre doesn't fit the station's character",
  "Track length unsuitable (too short or too long)",
  "Vocals or lyrics don't fit the station tone",
  "Sounds derivative, generic, or unfinished",
  "Copyright or clearance concerns",
  "Technical issue with the file (corrupt, wrong format)",
] as const;

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function fmtDur(s: number | null): string {
  if (s == null) return "?";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function SubmissionsPanel({ onPreview, activePreviewKey }: SubmissionsPanelProps) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [findEmail, setFindEmail] = useState("");
  const [showBySubmission, setShowBySubmission] = useState<Record<string, ShowSlug>>({});
  const [reviewedOpen, setReviewedOpen] = useState(false);

  // Restore the operator's last preference for the Recently-reviewed
  // disclosure. Defaults to collapsed on first visit. Read in useEffect
  // (not initial state) to avoid SSR/CSR hydration mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("numa.dashboard.submissions.reviewedOpen");
      if (stored === "1") setReviewedOpen(true);
    } catch {
      // localStorage might be blocked (private mode); fine, default stays collapsed
    }
  }, []);
  const [findRows, setFindRows] = useState<Reviewed[] | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [sweepStatus, setSweepStatus] = useState<SweepStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [listRes, sweepRes] = await Promise.all([
        fetch("/api/submissions/list", { cache: "no-store" }),
        fetch("/api/sweep-status", { cache: "no-store" }),
      ]);
      if (listRes.ok) setData((await listRes.json()) as ListResponse);
      if (sweepRes.ok) setSweepStatus((await sweepRes.json()) as SweepStatus);
    } catch {
      /* keep previous */
    }
  }, []);

  const findByEmail = useCallback(async () => {
    const email = findEmail.trim();
    if (!email) {
      setFindRows(null);
      return;
    }
    setFindLoading(true);
    try {
      const r = await fetch(`/api/submissions/find?email=${encodeURIComponent(email)}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        toast.error(`Search failed: HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { rows: Reviewed[] };
      setFindRows(j.rows);
    } catch (err) {
      toast.error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFindLoading(false);
    }
  }, [findEmail]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  /** Stop the bottom preview bar if it's currently playing this row.
   *  Called before any mutation so playback doesn't outlive its source. */
  function stopPreviewIf(id: string) {
    if (activePreviewKey === `submission:${id}`) onPreview(null);
  }

  async function approve(id: string) {
    stopPreviewIf(id);
    setBusy(id);
    try {
      const show = showBySubmission[id] ?? "daylight_channel";
      const r = await fetch(`/api/submissions/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ show }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      const showLabel = SHOW_OPTIONS.find((s) => s.value === show)?.label ?? show;
      toast.success(`Approved → ${showLabel} · artist notified by email.`);
      await refresh();
    } catch (err) {
      toast.error(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    const notes = rejectReason.trim();
    if (selectedReasons.length === 0 && notes.length < 3) {
      toast.error("Pick at least one reason or write a note (3+ chars).");
      return;
    }
    const combinedReason =
      selectedReasons.length > 0
        ? `${selectedReasons.join("; ")}${notes ? `. Notes: ${notes}` : ""}`
        : notes;
    stopPreviewIf(id);
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: combinedReason }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success("Rejected — artist notified by email.");
      setRejectingId(null);
      setRejectReason("");
      setSelectedReasons([]);
      await refresh();
    } catch (err) {
      toast.error(`Reject failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(id: string) {
    stopPreviewIf(id);
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "artist requested withdrawal" }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; keptContact?: boolean };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success(
        j.keptContact
          ? "Withdrawn — track pulled, email retained (permanent rotation)."
          : "Withdrawn — track pulled, email + name scrubbed (one-off).",
      );
      await refresh();
    } catch (err) {
      toast.error(`Withdraw failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function fullDelete(id: string) {
    stopPreviewIf(id);
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/full-delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "artist requested full deletion" }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success("Fully deleted — row, track, assets all removed.");
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return null;

  // Single row renderer reused by "Recently reviewed" and "Find by email"
  const renderReviewedRow = (r: Reviewed) => {
    const ts = r.withdrawnAt ?? r.reviewedAt;
    return (
      <li
        key={r.id}
        className="flex flex-col gap-2 rounded-lg border border-line/70 bg-bg p-3 transition-colors hover:border-line"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h4 className="truncate text-sm font-medium leading-tight text-fg" title={r.trackTitle ?? ""}>
              {r.trackTitle ?? <span className="font-normal italic text-fg-mute">Untitled</span>}
            </h4>
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-mute">
              <span className="truncate">{r.artistName}</span>
              <span className="text-fg-dim" aria-hidden>·</span>
              <span className="truncate font-mono text-[10px]" title={r.email}>{r.email}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em]">
            <span
              className={`rounded-full border px-2 py-0.5 ${
                r.status === "approved"
                  ? "border-accent/50 text-accent"
                  : r.status === "rejected"
                    ? "border-[var(--bad)]/40 text-bad"
                    : "border-line text-fg-mute"
              }`}
            >
              {r.status}
            </span>
            <span className="text-fg-dim">{ts ? relativeTime(ts) : "—"}</span>
          </div>
        </div>
        {r.trackGenre && (
          <span
            className="self-start rounded-full border border-line/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-mute"
            title="Genre supplied by the artist"
          >
            {r.trackGenre}
          </span>
        )}
        {r.status === "rejected" && r.rejectReason && (
          <p className="text-[11px] text-fg-mute italic">{r.rejectReason}</p>
        )}
        {r.status === "withdrawn" && r.withdrawnReason && (
          <p className="text-[11px] text-fg-mute italic">
            Withdrawn — {r.withdrawnReason}
          </p>
        )}
        {r.status === "approved" && (
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`px-1.5 py-0.5 rounded border text-[9px] ${
                r.airingPreference === "permanent"
                  ? "border-accent text-accent"
                  : "border-line text-fg-mute"
              }`}
            >
              {r.airingPreference === "permanent" ? "Perm" : "One-off"}
            </span>
            {confirmDelete === r.id ? (
              <>
                <span className="text-[10px] text-bad uppercase tracking-widest">
                  Delete everything?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => fullDelete(r.id)}
                  disabled={busy === r.id}
                  className="text-[10px] px-2 py-1 h-auto"
                >
                  {busy === r.id ? "…" : "Yes, wipe"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(null)}
                  className="text-[10px] px-2 py-1 h-auto"
                >
                  No
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => withdraw(r.id)}
                  disabled={busy !== null}
                  className="text-[10px] px-2 py-1 h-auto"
                  title="Pull from rotation. Permanent → keep email, One-off → scrub email."
                >
                  Withdraw
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(r.id)}
                  disabled={busy !== null}
                  className="text-[10px] px-2 py-1 h-auto border-bad/40 text-bad"
                  title="Wipe everything (track + row + assets). Use only if artist explicitly asks for total deletion."
                >
                  Full delete
                </Button>
              </>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
            Music submissions
          </CardTitle>
          <span className="font-mono text-[10px] text-fg-dim uppercase tracking-[0.15em]">
            {data.pending.length} pending · {data.reviewed.length} recent
          </span>
        </div>
        {/* Privacy retention sweep — runs daily at 04:00 UTC via Vercel
            Cron. Shows last run + cleanup counts + ETA on next. Helps
            operator confirm the schedule is alive without checking
            Vercel logs. */}
        <PrivacySweepChip status={sweepStatus} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.pending.length === 0 && (
          <p className="text-sm text-fg-mute">Nothing waiting.</p>
        )}

        <ul className="flex flex-col gap-4">
          {data.pending.map((p) => {
            const previewKey = `submission:${p.id}`;
            const isPreviewing = activePreviewKey === previewKey;
            return (
            <li
              key={p.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-4 transition-colors hover:border-line/80 hover:bg-bg/60"
            >
              {/* Header — track title leads, artist + email subtitle, time top-right */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h3
                    className="truncate text-[15px] font-semibold leading-tight text-fg"
                    title={p.trackTitle ?? ""}
                  >
                    {p.trackTitle ?? <span className="font-normal italic text-fg-mute">Untitled</span>}
                  </h3>
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-mute">
                    <span className="truncate">{p.artistName}</span>
                    <span className="text-fg-dim" aria-hidden>·</span>
                    <span className="truncate font-mono text-[11px]">{p.email}</span>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-dim">
                  {relativeTime(p.createdAt)}
                </span>
              </div>

              {/* Meta strip — uniform chips with the Preview pill docked right */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${
                      p.airingPreference === "permanent"
                        ? "border-accent/50 text-accent"
                        : "border-line text-fg-mute"
                    }`}
                  >
                    {p.airingPreference === "permanent" ? "Permanent" : "One-off"}
                  </span>
                  <span className="rounded-full border border-line/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] tabular-nums text-fg-mute">
                    {fmtDur(p.durationSeconds)}
                  </span>
                  {p.trackGenre && (
                    <span
                      className="rounded-full border border-line/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-mute"
                      title="Genre supplied by the artist"
                    >
                      {p.trackGenre}
                    </span>
                  )}
                  {p.artworkStorageKey && (
                    <span className="rounded-full border border-line/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-mute">
                      + artwork
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    isPreviewing
                      ? onPreview(null)
                      : onPreview({
                          key: previewKey,
                          title: p.trackTitle ?? `Untitled — ${p.artistName}`,
                          artist: p.artistName,
                          artworkUrl: null,
                          audioUrl: p.audioUrl,
                        })
                  }
                  aria-pressed={isPreviewing}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors ${
                    isPreviewing
                      ? "border-accent bg-[var(--accent-soft)] text-accent"
                      : "border-line text-fg-mute hover:border-accent/50 hover:text-accent"
                  }`}
                >
                  {isPreviewing ? (
                    <><PauseIcon size={11} strokeWidth={2.5} /> Pause</>
                  ) : (
                    <><PlayIcon size={11} strokeWidth={2.5} /> Preview</>
                  )}
                </button>
              </div>

              {/* Action row — separated by hairline so it reads as its own zone */}
              {rejectingId === p.id ? (
                <div className="mt-1 flex flex-col gap-3 rounded-md border border-line/70 bg-bg-1/40 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
                    Why rejecting?
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {REJECT_REASONS.map((r) => {
                      const checked = selectedReasons.includes(r);
                      return (
                        <li key={r}>
                          <label className="flex items-start gap-2 text-xs cursor-pointer hover:text-fg">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedReasons((prev) =>
                                  checked ? prev.filter((x) => x !== r) : [...prev, r],
                                )
                              }
                              className="mt-0.5 accent-accent"
                            />
                            <span className={checked ? "text-fg" : "text-fg-mute"}>{r}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Additional notes (optional, plain text)…"
                    rows={2}
                    className="bg-bg border border-line rounded p-2 text-sm outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => reject(p.id)}
                      disabled={busy === p.id}
                    >
                      {busy === p.id ? "…" : "Confirm reject"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectReason("");
                        setSelectedReasons([]);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 border-t border-line/50 pt-3">
                  <Select
                    value={showBySubmission[p.id] ?? "daylight_channel"}
                    onValueChange={(v) => {
                      if (typeof v === "string" && v) {
                        setShowBySubmission((prev) => ({ ...prev, [p.id]: v as ShowSlug }));
                      }
                    }}
                    disabled={busy === p.id}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-[200px] font-mono text-xs disabled:opacity-50"
                      title="Show this track will be added to on approve"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHOW_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value} className="font-mono text-xs">
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => approve(p.id)}
                    disabled={busy === p.id}
                  >
                    {busy === p.id ? "…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejectingId(p.id)}
                    disabled={busy !== null}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </li>
            );
          })}
        </ul>

        {/* Find-by-email — for acting on tracks older than the recent-20 list */}
        <details className="mt-2">
          <summary className="text-xs uppercase tracking-widest text-fg-mute cursor-pointer">
            Find by email (artist withdrawal requests)
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                findByEmail();
              }}
            >
              <input
                type="email"
                value={findEmail}
                onChange={(e) => setFindEmail(e.target.value)}
                placeholder="artist@example.com"
                className="flex-1 bg-bg border border-line rounded px-2 py-1.5 text-sm font-mono outline-none focus:border-accent"
              />
              <Button
                size="sm"
                type="submit"
                disabled={findLoading || findEmail.trim().length < 3}
                className="text-[10px] px-3 py-1 h-auto"
              >
                {findLoading ? "…" : "Find"}
              </Button>
              {findRows && (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setFindRows(null);
                    setFindEmail("");
                  }}
                  className="text-[10px] px-3 py-1 h-auto"
                >
                  Clear
                </Button>
              )}
            </form>
            {findRows && findRows.length === 0 && (
              <p className="text-[11px] text-fg-mute">No submissions found for that email.</p>
            )}
            {findRows && findRows.length > 0 && (
              <ul className="flex flex-col gap-2 text-xs">
                {findRows.map(renderReviewedRow)}
              </ul>
            )}
          </div>
        </details>

        {data.reviewed.length > 0 && (
          <details
            className="mt-2"
            open={reviewedOpen}
            onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setReviewedOpen(open);
              try {
                window.localStorage.setItem(
                  "numa.dashboard.submissions.reviewedOpen",
                  open ? "1" : "0",
                );
              } catch {
                // ignore storage failures
              }
            }}
          >
            <summary className="text-xs uppercase tracking-widest text-fg-mute cursor-pointer">
              Recently reviewed ({data.reviewed.length})
            </summary>
            <ul className="mt-3 flex flex-col gap-2 text-xs">
              {data.reviewed.map(renderReviewedRow)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function PrivacySweepChip({ status }: { status: SweepStatus | null }) {
  if (!status) return null;
  const next = nextSweepAt();
  const lastRunIso = status.lastRun;
  const totalCleaned = status.counts
    ? status.counts.shoutoutsDeleted +
      status.counts.songRequestsDeleted +
      status.counts.rejectedSubmissionsDeleted
    : 0;
  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.14em]">
      <span className="px-2 py-1 rounded border border-line text-fg-mute">
        Privacy sweep
      </span>
      <span className="text-fg-dim">
        {lastRunIso
          ? `Last run · ${relativeTime(lastRunIso)} · cleaned ${totalCleaned}`
          : "Never run yet"}
      </span>
      <span className="text-fg-mute">
        Next · {fmtSweepIn(next)}
      </span>
    </div>
  );
}
