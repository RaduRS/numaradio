"use client";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ShoutoutRow } from "@/lib/shoutouts";

// ─── Types ─────────────────────────────────────────────────────────

interface ListResponse {
  // Held shoutouts also surface on the main dashboard (/) — we don't
  // duplicate the action UI here, but we still fetch `held` so the
  // header counter reflects the moderation queue size.
  held: ShoutoutRow[];
  recent: ShoutoutRow[];
}

// Matches what `workers/queue-daemon/index.ts` pushes into its
// lastPushes / lastFailures ring buffers. Fields are optional because
// the buffer's schema predates some of them.
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

type LogEventKind = "shoutout" | "chatter" | "announce" | "failure";

interface LogEventBase {
  kind: LogEventKind;
  at: string;
  id: string;
}
interface ShoutoutEvent extends LogEventBase {
  kind: "shoutout";
  text: string;
  sender: string;
  deliveryStatus: string;
  moderationReason?: string;
}
interface ChatterEvent extends LogEventBase {
  kind: "chatter";
  script: string;
  type: string; // back_announce, shoutout_cta, song_cta, filler
  slot: string; // "slot3"
}
interface AnnounceEvent extends LogEventBase {
  kind: "announce";
  script: string;
  trackId: string;
}
interface FailureEvent extends LogEventBase {
  kind: "failure";
  reason: string;
  detail?: string;
}
type LogEvent = ShoutoutEvent | ChatterEvent | AnnounceEvent | FailureEvent;

// ─── Utilities ─────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 600) return `${Math.floor(sec / 60)}m ago`;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return hhmm;
  const mmmdd = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${mmmdd} ${hhmm}`;
}

function deliveryBadgeClass(status: string): string {
  if (status === "aired") return "border-accent text-accent bg-[var(--accent-soft)]";
  if (status === "failed" || status === "blocked") return "border-[var(--bad)] text-[var(--bad)]";
  if (status === "held" || status === "pending") return "border-[var(--warn)] text-[var(--warn)]";
  return "border-fg-mute text-fg-mute";
}

function kindAccent(kind: LogEventKind): { border: string; label: string } {
  // Left-edge accent color per event kind. Reserved for categories the
  // operator actually needs to notice — announce / chatter (teal family)
  // and failure (red). Regular shoutouts are the page's main content,
  // so they get a neutral hairline instead of a loud yellow stripe.
  switch (kind) {
    case "announce":
      return { border: "border-l-[var(--accent)]", label: "text-accent" };
    case "chatter":
      return { border: "border-l-[var(--accent-soft,theme(colors.teal.900))]", label: "text-accent/70" };
    case "shoutout":
      return { border: "border-l-transparent", label: "text-fg-dim" };
    case "failure":
      return { border: "border-l-[var(--bad)]", label: "text-[var(--bad)]" };
  }
}

// ─── Component ─────────────────────────────────────────────────────

const COMPOSE_MAX = 500;

type LogFilter = "all" | "shoutouts" | "chatter" | "announce" | "failures";
const FILTER_LABELS: Record<LogFilter, string> = {
  all: "All",
  shoutouts: "Shoutouts",
  chatter: "Auto-chatter",
  announce: "Announcements",
  failures: "Failures",
};

type AutoHostMode = "auto" | "forced_on" | "forced_off";
interface AutoHostState {
  mode: AutoHostMode;
  forcedUntil: string | null;
}

function formatRevertCountdown(forcedUntilIso: string | null, nowMs: number): string {
  if (!forcedUntilIso) return "reverting…";
  const ms = new Date(forcedUntilIso).getTime() - nowMs;
  if (ms <= 0) return "reverting…";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 1) return `reverts to Auto in ${min}m ${sec.toString().padStart(2, "0")}s`;
  return `reverts to Auto in ${sec}s`;
}

export default function ShoutoutsPage() {
  const { data, isStale, refresh } = usePolling<ListResponse>(
    "/api/shoutouts/list",
    8_000,
  );
  const daemonPoll = usePolling<DaemonStatusResponse>(
    "/api/library/recent-pushes",
    5_000,
  );
  const [composeText, setComposeText] = useState("");
  const [composing, setComposing] = useState(false);
  const [autoHost, setAutoHost] = useState<AutoHostState | null>(null);
  const [autoHostPending, setAutoHostPending] = useState(false);
  const [listenerCount, setListenerCount] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [logFilter, setLogFilter] = useState<LogFilter>("all");

  // Fetch initial auto-host state.
  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const r = await fetch("/api/shoutouts/auto-host");
        const d = (await r.json()) as {
          ok?: boolean;
          mode?: AutoHostMode;
          forcedUntil?: string | null;
        };
        if (!cancel && d.ok && d.mode) {
          setAutoHost({ mode: d.mode, forcedUntil: d.forcedUntil ?? null });
        }
      } catch { /* ignore */ }
    }
    void load();
    return () => { cancel = true; };
  }, []);

  // Poll real listener count (raw Icecast, not +15 boosted) for the
  // "Auto — currently On (7 listeners)" display.
  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const r = await fetch("/api/station/listeners");
        const d = (await r.json()) as { listeners?: number | null };
        if (!cancel && typeof d.listeners === "number") {
          setListenerCount(d.listeners);
        }
      } catch { /* ignore */ }
    }
    void load();
    const id = setInterval(load, 15_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  // Tick every second while a forced state has a countdown, so the
  // "reverts in 18 min" label updates without a full refresh.
  useEffect(() => {
    if (!autoHost?.forcedUntil) return;
    const id = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [autoHost?.forcedUntil]);

  async function setAutoHostMode(next: AutoHostMode) {
    setAutoHostPending(true);
    try {
      const r = await fetch("/api/shoutouts/auto-host", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        mode?: AutoHostMode;
        forcedUntil?: string | null;
      };
      if (d.ok && d.mode) {
        setAutoHost({ mode: d.mode, forcedUntil: d.forcedUntil ?? null });
      }
    } finally {
      setAutoHostPending(false);
    }
  }

  async function compose() {
    const text = composeText.trim();
    if (text.length < 4) {
      toast.error("Type something for Lena to read.");
      return;
    }
    setComposing(true);
    try {
      const res = await fetch("/api/shoutouts/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (res.ok && body.ok) {
        toast.success(body.message ?? "Queued — Lena will read it next.");
        setComposeText("");
        refresh();
      } else {
        toast.error(body.error ?? "Failed to queue shoutout.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setComposing(false);
    }
  }

  const held = data?.held ?? [];
  const recent = data?.recent ?? [];

  // ─── Build unified On Air Log feed ──────────────────────────────
  const events = useMemo<LogEvent[]>(() => {
    const list: LogEvent[] = [];

    // Shoutouts from the Shoutout table — only ones that have actually
    // transitioned past moderation (held items live in the sidebar, not
    // the log).
    for (const s of recent) {
      if (s.deliveryStatus === "held" || s.deliveryStatus === "pending") continue;
      list.push({
        kind: "shoutout",
        id: `s-${s.id}`,
        at: s.updatedAt,
        text: s.broadcastText ?? s.cleanText ?? s.rawText,
        sender: s.requesterName ?? "anonymous",
        deliveryStatus: s.deliveryStatus,
        moderationReason: s.moderationReason ?? undefined,
      });
    }

    // Daemon lastPushes split into chatter / announce / unknown.
    for (const p of daemonPoll.data?.lastPushes ?? []) {
      if (!p.trackId || !p.at) continue;
      if (p.trackId.startsWith("auto-chatter:")) {
        // trackId format: auto-chatter:<chatterId>:<type>:slot<N>
        const parts = p.trackId.split(":");
        list.push({
          kind: "chatter",
          id: `c-${p.at}-${parts[1] ?? ""}`,
          at: p.at,
          script: p.script ?? "",
          type: parts[2] ?? "?",
          slot: parts[3] ?? "?",
        });
      } else if (p.trackId.startsWith("announce:")) {
        // trackId format: announce:<realTrackId>:<chatterId>
        const parts = p.trackId.split(":");
        list.push({
          kind: "announce",
          id: `a-${p.at}-${parts[1] ?? ""}`,
          at: p.at,
          script: p.script ?? "",
          trackId: parts[1] ?? "",
        });
      }
      // ignore other trackIds (regular music pushes from /library etc.)
    }

    // Daemon lastFailures — filtered to voice-related reasons.
    for (const f of daemonPoll.data?.lastFailures ?? []) {
      if (!f.reason || !f.at) continue;
      if (
        f.reason.startsWith("auto_chatter_") ||
        f.reason.startsWith("listener_song_announce_")
      ) {
        list.push({
          kind: "failure",
          id: `f-${f.at}-${f.reason}`,
          at: f.at,
          reason: f.reason,
          detail: f.detail,
        });
      }
    }

    // Sort newest-first.
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [recent, daemonPoll.data]);

  const filteredEvents = useMemo(() => {
    if (logFilter === "all") return events;
    return events.filter((e) => {
      if (logFilter === "shoutouts") return e.kind === "shoutout";
      if (logFilter === "chatter") return e.kind === "chatter";
      if (logFilter === "announce") return e.kind === "announce";
      if (logFilter === "failures") return e.kind === "failure";
      return true;
    });
  }, [events, logFilter]);

  const totalAired = events.filter((e) => e.kind !== "failure").length;
  const totalFailed = events.filter((e) => e.kind === "failure").length;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 flex flex-col gap-5 sm:gap-6 sm:px-6 sm:py-8">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex flex-col gap-1">
        <h1
          className="font-display text-3xl font-extrabold uppercase tracking-wide text-fg"
          style={{ fontStretch: "115%" }}
        >
          Shoutouts
        </h1>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Shoutouts · {held.length} held · {totalAired} on-air events · {totalFailed} failures
          {isStale ? " · ⚠ stale, retrying" : ""}
        </span>
      </header>

      {/* ── Auto-chatter mode strip ────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-md border border-line bg-bg-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              autoHost?.mode === "forced_off" ? "bg-fg-mute/30" :
              autoHost?.mode === "forced_on" ? "bg-accent" :
              // auto: dot reflects computed state
              (listenerCount ?? 0) >= 5 ? "bg-accent" : "bg-fg-mute/30"
            }`}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Auto-chatter
            </div>
            <div className="truncate text-sm">
              {autoHost === null ? (
                "Loading…"
              ) : autoHost.mode === "auto" ? (
                listenerCount === null
                  ? "Auto — currently On (listener count unavailable)"
                  : listenerCount >= 5
                    ? `Auto — currently On (${listenerCount} listeners)`
                    : `Auto — currently Off (${listenerCount} listeners, need 5+)`
              ) : autoHost.mode === "forced_on" ? (
                `Forced On · ${formatRevertCountdown(autoHost.forcedUntil, nowTick)}`
              ) : (
                `Forced Off · ${formatRevertCountdown(autoHost.forcedUntil, nowTick)}`
              )}
            </div>
          </div>
        </div>
        <div
          className="flex shrink-0 rounded-full border border-line overflow-hidden font-mono text-[11px] uppercase tracking-[0.15em]"
          role="radiogroup"
          aria-label="Auto-chatter mode"
        >
          {(["auto", "forced_on", "forced_off"] as const).map((m) => {
            const selected = autoHost?.mode === m;
            const label = m === "auto" ? "Auto" : m === "forced_on" ? "Forced On" : "Forced Off";
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={autoHost === null || autoHostPending}
                onClick={() => setAutoHostMode(m)}
                className={`px-3 py-1.5 transition ${
                  selected
                    ? "bg-[var(--accent-soft)] text-accent"
                    : "text-fg-mute hover:text-fg"
                } ${autoHostPending ? "opacity-60 cursor-wait" : ""}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Compose ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-fg-mute">
            Type exactly what Lena should say on air — no moderation,
            no rate limit. Airs at the next track boundary.
          </p>
          <textarea
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            placeholder='e.g. "This one goes out to Mihai — happy birthday, champ. Back to the music."'
            maxLength={COMPOSE_MAX}
            rows={3}
            className="w-full resize-y rounded-md border border-[var(--line)] bg-transparent p-3 text-sm font-sans focus:outline-none focus:border-accent"
            disabled={composing}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                compose();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-mute">
              {composeText.length}/{COMPOSE_MAX} · ⌘/Ctrl+Enter to send
            </span>
            <Button size="sm" onClick={compose} disabled={composing}>
              {composing ? "Sending…" : "Send to Lena"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Held shoutouts are handled on the main dashboard (/) — kept out
          of this page so operators have one canonical "action required"
          surface to watch. */}

      {/* ── On-Air Log ───────────────────────────────────── */}
      <Card className="bg-bg-1 border-line">
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
                  On-Air Log
                </CardTitle>
                <div className="flex items-center gap-1 flex-wrap">
                  {(["all", "shoutouts", "chatter", "announce", "failures"] as LogFilter[]).map((f) => {
                    const count =
                      f === "all" ? events.length :
                      f === "shoutouts" ? events.filter(e => e.kind === "shoutout").length :
                      f === "chatter" ? events.filter(e => e.kind === "chatter").length :
                      f === "announce" ? events.filter(e => e.kind === "announce").length :
                      events.filter(e => e.kind === "failure").length;
                    const active = logFilter === f;
                    return (
                      <button
                        key={f}
                        onClick={() => setLogFilter(f)}
                        className={`font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-1 rounded-full border transition ${
                          active
                            ? "border-accent text-accent bg-[var(--accent-soft)]"
                            : "border-line text-fg-mute hover:text-fg hover:border-fg-mute"
                        }`}
                      >
                        {FILTER_LABELS[f]} <span className="opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!daemonPoll.data && !data ? (
                <div className="px-4 py-8 text-sm text-fg-mute">Loading…</div>
              ) : filteredEvents.length === 0 ? (
                <div className="px-4 py-8 text-sm text-fg-mute text-center">
                  {logFilter === "all"
                    ? autoHost?.mode === "forced_on" || (autoHost?.mode === "auto" && (listenerCount ?? 0) >= 5)
                      ? "Waiting for the first voice event…"
                      : "Nothing on air yet. Set auto-chatter mode above, submit a shoutout, or compose one."
                    : `No ${FILTER_LABELS[logFilter].toLowerCase()} yet.`}
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {filteredEvents.slice(0, 50).map((evt) => (
                    <LogRow key={evt.id} event={evt} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
    </main>
  );
}

// ─── Log row component ─────────────────────────────────────────────

function LogRow({ event }: { event: LogEvent }) {
  const accent = kindAccent(event.kind);
  return (
    <li className={`px-4 py-3 border-l-2 ${accent.border}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.2em] ${accent.label}`}
            >
              {event.kind === "shoutout" && "Shoutout"}
              {event.kind === "chatter" && `Auto-chatter · ${event.type}`}
              {event.kind === "announce" && "Announcement"}
              {event.kind === "failure" && "Failure"}
            </span>
            {event.kind === "shoutout" && (
              <>
                <Badge
                  variant="outline"
                  className={deliveryBadgeClass(event.deliveryStatus)}
                >
                  {event.deliveryStatus}
                </Badge>
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-mute">
                  {event.sender}
                </span>
              </>
            )}
            {event.kind === "chatter" && (
              <span className="font-mono text-[10px] text-fg-mute">
                {event.slot}
              </span>
            )}
            {event.kind === "announce" && (
              <span className="font-mono text-[10px] text-fg-mute">
                new listener song
              </span>
            )}
            {event.kind === "failure" && (
              <span className="font-mono text-[10px] text-[var(--bad)]/80">
                {event.reason}
              </span>
            )}
          </div>
          {event.kind === "shoutout" && (
            <p className="text-sm italic">&ldquo;{event.text}&rdquo;</p>
          )}
          {(event.kind === "chatter" || event.kind === "announce") && event.script && (
            <p className="text-sm italic text-fg/90">&ldquo;{event.script}&rdquo;</p>
          )}
          {(event.kind === "chatter" || event.kind === "announce") && !event.script && (
            <p className="text-xs text-fg-mute italic">(script not captured)</p>
          )}
          {event.kind === "failure" && event.detail && (
            <p className="font-mono text-[11px] text-fg-mute break-all" title={event.detail}>
              {event.detail.length > 160 ? event.detail.slice(0, 160) + "…" : event.detail}
            </p>
          )}
          {event.kind === "shoutout" &&
            event.deliveryStatus !== "aired" &&
            event.moderationReason && (
              <p className="mt-1 text-xs text-fg-mute">
                {event.moderationReason}
              </p>
            )}
        </div>
        <span className="font-mono text-[11px] text-fg-mute shrink-0 pt-0.5">
          {fmtRelative(event.at)}
        </span>
      </div>
    </li>
  );
}
