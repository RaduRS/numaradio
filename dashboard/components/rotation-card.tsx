"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LastRefresh = { librarySize: number; cyclePlayed: number; poolSize: number; cycleWrapped: boolean; at: number };

export function RotationCard() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<LastRefresh | null>(null);

  async function reshuffle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/rotation/reshuffle", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Reshuffle failed: ${j.error ?? res.status}`);
        return;
      }
      setLast({ ...j, at: Date.now() });
      toast.success(
        j.cycleWrapped
          ? `New cycle started (${j.poolSize} tracks)`
          : `Reshuffled — ${j.poolSize} tracks remain in cycle`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader>
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Rotation
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex items-center justify-between gap-4">
        <div className="text-xs text-fg-mute">
          {last ? (
            <>
              <div className="text-fg tabular-nums">
                {last.poolSize} of {last.librarySize} tracks left in current cycle
                {last.cycleWrapped ? " · wrapped" : ""}
              </div>
              <div className="text-fg-dim mt-0.5">
                last reshuffle {Math.max(1, Math.round((Date.now() - last.at) / 1000))}s ago
              </div>
            </>
          ) : (
            <div>Forces a fresh shuffle of /etc/numa/playlist.m3u from the current cycle pool.</div>
          )}
        </div>
        <button
          type="button"
          onClick={reshuffle}
          disabled={busy}
          className="text-[11px] uppercase tracking-[0.12em] text-fg border border-line rounded px-3 py-2 hover:border-fg-dim hover:bg-bg-2 disabled:opacity-50 disabled:cursor-wait transition-colors shrink-0"
        >
          {busy ? "Reshuffling…" : "Reshuffle now"}
        </button>
      </CardContent>
    </Card>
  );
}
