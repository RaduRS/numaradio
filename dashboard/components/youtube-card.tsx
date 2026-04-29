"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { YoutubeBroadcastSnapshot } from "@/lib/youtube";
import { usePolling } from "@/hooks/use-polling";

interface Props {
  data: YoutubeBroadcastSnapshot | null;
  isStale: boolean;
}

interface QuotaPayload {
  quota: {
    date: string;
    unitsUsed: number;
    limit: number;
    resetsInSeconds: number;
  };
  youtubeChatPollMs: number;
}

interface EncoderState {
  state: string;
}

interface PillStyle {
  label: string;
  bg: string;
  border: string;
  text: string;
  pulse: boolean;
}

function statusPill(snap: YoutubeBroadcastSnapshot | null): PillStyle {
  if (!snap || snap.state === "error") {
    return {
      label: snap?.state === "error" ? "API ERROR" : "—",
      bg: "bg-fg-mute/10",
      border: "border-fg-mute/30",
      text: "text-fg-mute",
      pulse: false,
    };
  }
  if (snap.state === "off") {
    return {
      label: "OFF AIR",
      bg: "bg-fg-mute/10",
      border: "border-fg-mute/30",
      text: "text-fg-mute",
      pulse: false,
    };
  }
  if (snap.state === "ready") {
    return {
      label: "READY",
      bg: "bg-amber-500/10",
      border: "border-amber-500/40",
      text: "text-amber-400",
      pulse: false,
    };
  }
  // state === "live" — colour by stream health.
  if (snap.health === "good") {
    return {
      label: "LIVE · GOOD",
      bg: "bg-accent/10",
      border: "border-accent/40",
      text: "text-accent",
      pulse: true,
    };
  }
  if (snap.health === "ok") {
    return {
      label: "LIVE · OK",
      bg: "bg-accent/8",
      border: "border-accent/30",
      text: "text-accent",
      pulse: true,
    };
  }
  if (snap.health === "bad") {
    return {
      label: "LIVE · DEGRADED",
      bg: "bg-amber-500/10",
      border: "border-amber-500/40",
      text: "text-amber-400",
      pulse: true,
    };
  }
  if (snap.health === "noData") {
    return {
      label: "LIVE · NO INGEST",
      bg: "bg-red-500/10",
      border: "border-red-500/40",
      text: "text-red-400",
      pulse: true,
    };
  }
  return {
    label: "LIVE",
    bg: "bg-accent/10",
    border: "border-accent/40",
    text: "text-accent",
    pulse: true,
  };
}

function fmtViewers(n: number | null): string {
  if (n === null) return "—";
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function fmtResetsIn(seconds: number): string {
  if (seconds <= 0) return "any moment";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function quotaBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-accent";
}

export function YoutubeCard({ data, isStale }: Props) {
  const pill = statusPill(data);
  const watchUrl = data?.videoId
    ? `https://www.youtube.com/watch?v=${data.videoId}`
    : null;
  const studioUrl = "https://studio.youtube.com/channel/UC/livestreaming";

  // Poll quota + cadence every 60s. Same cadence as the parent's
  // YouTube health card — keeps things in lockstep.
  const quotaPoll = usePolling<QuotaPayload>("/api/youtube/quota", 60_000);
  // Encoder state (systemd is-active) every 30s. Drives the
  // Stop/Start button label.
  const encoderPoll = usePolling<EncoderState>("/api/youtube/encoder", 30_000);
  const [encoderBusy, setEncoderBusy] = useState(false);
  const [encoderErr, setEncoderErr] = useState<string | null>(null);

  const encoderState = encoderPoll.data?.state ?? "unknown";
  const encoderActive = encoderState === "active";

  const onEncoderAction = async (action: "stop" | "start") => {
    setEncoderErr(null);
    if (
      action === "stop" &&
      !confirm("Stop the YouTube encoder? The stream will go dark on YouTube.")
    ) {
      return;
    }
    setEncoderBusy(true);
    try {
      const r = await fetch("/api/youtube/encoder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      // Give systemd a beat to settle before we reflect the new state.
      setTimeout(() => encoderPoll.refresh(), 1500);
    } catch (e) {
      setEncoderErr(e instanceof Error ? e.message : "action failed");
    } finally {
      setEncoderBusy(false);
    }
  };
  const [cadenceInput, setCadenceInput] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // Sync local input from the server snapshot whenever it arrives,
  // unless the user is in the middle of editing (input non-empty
  // and different from server value).
  useEffect(() => {
    if (!quotaPoll.data) return;
    const serverSeconds = Math.round(quotaPoll.data.youtubeChatPollMs / 1000);
    setCadenceInput((prev) => (prev === "" ? String(serverSeconds) : prev));
  }, [quotaPoll.data]);

  const onSaveCadence = async () => {
    setSaveErr(null);
    const seconds = Number(cadenceInput);
    if (!Number.isFinite(seconds) || seconds < 15 || seconds > 600) {
      setSaveErr("15–600 s only");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/youtube/chat-cadence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeChatPollMs: seconds * 1000 }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      quotaPoll.refresh();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const quota = quotaPoll.data?.quota;
  const used = quota?.unitsUsed ?? 0;
  const limit = quota?.limit ?? 10_000;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const serverCadenceSec = quotaPoll.data
    ? Math.round(quotaPoll.data.youtubeChatPollMs / 1000)
    : null;
  const cadenceDirty =
    serverCadenceSec !== null && cadenceInput !== String(serverCadenceSec);

  return (
    <Card className={`bg-bg-1 border-line ${isStale ? "opacity-70" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          YouTube · 24/7 Broadcast
        </CardTitle>
        <a
          href={studioUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute transition-colors hover:text-accent"
          title="Open YouTube Studio live dashboard"
        >
          Studio →
        </a>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${pill.bg} ${pill.border} ${pill.text}`}
          >
            <span className="relative inline-flex h-2 w-2">
              {pill.pulse && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full bg-current opacity-60"
                />
              )}
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-current"
              />
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.2em]">
              {pill.label}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Concurrent
            </span>
            <span className="font-display text-xl font-extrabold tabular-nums text-fg">
              {fmtViewers(data?.concurrentViewers ?? null)}
            </span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Title
            </div>
            <div className="truncate text-sm text-fg" title={data?.title ?? ""}>
              {data?.title ?? "—"}
            </div>
          </div>
          {watchUrl && (
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 self-end rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim transition-colors hover:border-accent/50 hover:text-accent"
            >
              Watch →
            </a>
          )}
        </div>

        {data?.state === "error" && data.error && (
          <div
            className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300"
            title={data.error}
          >
            {data.error.slice(0, 200)}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
            <span>API Quota · today</span>
            <span>{quota ? `resets in ${fmtResetsIn(quota.resetsInSeconds)}` : "—"}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg-mute/15">
              <div
                className={`h-full transition-all duration-300 ${quotaBarColor(pct)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="font-mono text-xs tabular-nums text-fg">
              {used.toLocaleString()}/{limit.toLocaleString()}
              <span className="ml-1 text-fg-mute">({pct}%)</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
            <span>Encoder · Orion</span>
            <span
              className={
                encoderActive
                  ? "text-accent"
                  : encoderState === "unknown"
                    ? "text-fg-mute"
                    : "text-amber-400"
              }
            >
              {encoderState}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEncoderAction(encoderActive ? "stop" : "start")}
              disabled={encoderBusy || encoderState === "unknown"}
              className={`rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors disabled:opacity-40 ${
                encoderActive
                  ? "border-red-500/40 text-red-300 enabled:hover:bg-red-500/10"
                  : "border-accent/40 text-accent enabled:hover:bg-accent/10"
              }`}
            >
              {encoderBusy
                ? "Working…"
                : encoderActive
                  ? "Stop encoder"
                  : "Start encoder"}
            </button>
            {encoderErr && (
              <span className="font-mono text-[11px] text-red-400">{encoderErr}</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
            Chat poll cadence (15–600 s) · lower = lower latency, higher quota
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={15}
              max={600}
              step={5}
              value={cadenceInput}
              onChange={(e) => setCadenceInput(e.target.value)}
              className="w-24 rounded-md border border-line bg-bg-1 px-2 py-1 font-mono text-sm tabular-nums text-fg focus:border-accent focus:outline-none"
              aria-label="Chat poll cadence in seconds"
              disabled={saving}
            />
            <span className="font-mono text-xs text-fg-mute">s</span>
            <button
              type="button"
              onClick={onSaveCadence}
              disabled={!cadenceDirty || saving}
              className="rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim transition-colors enabled:hover:border-accent/50 enabled:hover:text-accent disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saveErr && (
              <span className="font-mono text-[11px] text-red-400">{saveErr}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
