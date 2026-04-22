"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ShoutoutRow } from "@/lib/shoutouts";
import { HeldShoutoutsCard } from "@/components/held-shoutouts-card";

interface ListResponse {
  held: ShoutoutRow[];
  recent: ShoutoutRow[];
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 600) return `${Math.floor(sec / 60)}m ago`; // keep relative for <10m
  // Beyond 10 minutes, show absolute clock time — easier to reason about.
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

function deliveryBadge(status: string): string {
  if (status === "aired") return "border-accent text-accent bg-[var(--accent-soft)]";
  if (status === "failed") return "border-[var(--bad)] text-[var(--bad)]";
  if (status === "blocked") return "border-[var(--bad)] text-[var(--bad)]";
  if (status === "held") return "border-[var(--warn)] text-[var(--warn)]";
  if (status === "pending") return "border-[var(--warn)] text-[var(--warn)]";
  return "border-fg-mute text-fg-mute";
}

const COMPOSE_MAX = 500;

export default function ShoutoutsPage() {
  const { data, isStale, refresh } = usePolling<ListResponse>(
    "/api/shoutouts/list",
    8_000,
  );
  const [composeText, setComposeText] = useState("");
  const [composing, setComposing] = useState(false);
  const [autoHostOn, setAutoHostOn] = useState<boolean | null>(null);
  const [autoHostPending, setAutoHostPending] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch("/api/shoutouts/auto-host")
      .then((r) => r.json())
      .then((d: { ok?: boolean; enabled?: boolean }) => {
        if (!cancel && d.ok) setAutoHostOn(Boolean(d.enabled));
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);

  async function toggleAutoHost(next: boolean) {
    setAutoHostPending(true);
    try {
      const r = await fetch("/api/shoutouts/auto-host", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const d = (await r.json()) as { ok?: boolean; enabled?: boolean };
      if (d.ok) setAutoHostOn(Boolean(d.enabled));
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
          Shoutouts · {held.length} held · {recent.length} recent · polling every 8s{isStale ? " · ⚠ stale, retrying" : ""}
        </span>
      </header>

      <Card className="bg-bg-1 border-line">
        <CardHeader className="gap-2">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
            Auto-chatter
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm text-fg-mute">
            <div className="text-fg font-medium">Lena speaks between every 2 tracks</div>
            <div className="text-xs">
              …when no shoutout airs in that window. Changes take effect within 30 s.
            </div>
          </div>
          <button
            type="button"
            disabled={autoHostOn === null || autoHostPending}
            onClick={() => autoHostOn !== null && toggleAutoHost(!autoHostOn)}
            className={`font-mono text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-full border transition ${
              autoHostOn
                ? "border-accent text-accent bg-[var(--accent-soft)]"
                : "border-line text-fg-mute hover:text-fg hover:border-fg-mute"
            } ${autoHostPending ? "opacity-60 cursor-wait" : ""}`}
            aria-pressed={autoHostOn === true}
          >
            {autoHostOn === null ? "…" : autoHostOn ? "On" : "Off"}
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-fg-mute">
            Type exactly what Lena should say on air — no moderation, no
            rate limit. Airs at the next track boundary.
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

      <HeldShoutoutsCard
        held={held}
        onAction={refresh}
      />

      <Card>
        <CardHeader>
          <CardTitle>Recent</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-fg-mute">No shoutouts yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--line)]">
              {recent.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <Badge
                        variant="outline"
                        className={deliveryBadge(s.deliveryStatus)}
                      >
                        {s.deliveryStatus}
                      </Badge>
                      <span className="font-mono text-xs uppercase tracking-[0.15em]">
                        {s.requesterName ?? "anonymous"}
                      </span>
                      <span className="font-mono text-[10px] text-fg-mute">
                        {fmtRelative(s.updatedAt)}
                      </span>
                    </div>
                    <p className="text-sm">
                      &ldquo;{s.broadcastText ?? s.cleanText ?? s.rawText}&rdquo;
                    </p>
                    {s.deliveryStatus !== "aired" && s.moderationReason && (
                      <p className="mt-1 text-xs text-fg-mute">
                        {s.moderationReason}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
