"use client";
import { useState } from "react";
import { toast } from "sonner";

export function ReshuffleButton() {
  const [busy, setBusy] = useState(false);

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
      toast.success(
        j.cycleWrapped
          ? `New cycle — ${j.poolSize} of ${j.librarySize} tracks`
          : `Reshuffled — ${j.poolSize} of ${j.librarySize} left in cycle`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={reshuffle}
      disabled={busy}
      title="Reshuffles the rotation pool: full library minus tracks already aired in the current cycle (and the currently-playing track)."
      className="shrink-0 self-center font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute border border-[var(--line)] rounded px-3 py-2 hover:text-fg hover:border-fg-dim hover:bg-[var(--bg-2)] disabled:opacity-50 disabled:cursor-wait transition-colors"
    >
      {busy ? "Reshuffling…" : "Reshuffle"}
    </button>
  );
}
