"use client";
import { useEffect, useState } from "react";

type VoiceProvider = "deepgram" | "vertex";

const LABELS: Record<VoiceProvider, { name: string; sub: string }> = {
  deepgram: { name: "HELENA", sub: "deepgram" },
  vertex: { name: "LEDA", sub: "google" },
};

export function VoiceProviderTile() {
  const [provider, setProvider] = useState<VoiceProvider | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voice-provider")
      .then((r) => r.json())
      .then((j: { ok: boolean; provider?: VoiceProvider; error?: string }) => {
        if (cancelled) return;
        if (j.ok && j.provider) setProvider(j.provider);
        else setError(j.error ?? "fetch failed");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (!provider || pending) return;
    const next: VoiceProvider = provider === "deepgram" ? "vertex" : "deepgram";
    setProvider(next);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/voice-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: next }),
      });
      const j = (await res.json()) as { ok: boolean; provider?: VoiceProvider; error?: string };
      if (!j.ok || !j.provider) {
        setProvider(provider);
        setError(j.error ?? "save failed");
      } else {
        setProvider(j.provider);
      }
    } catch (e) {
      setProvider(provider);
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setPending(false);
    }
  }

  const label = provider ? LABELS[provider] : null;
  const display = label?.name ?? "—";
  const sub = error ?? label?.sub ?? "loading";
  const isVertex = provider === "vertex";
  const ariaLabel = provider
    ? `Voice provider, currently ${label!.name} on ${label!.sub}. Click to swap.`
    : "Voice provider, loading";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg-1)] px-4 py-3.5 sm:px-5 sm:py-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
        Voice
      </span>
      <span
        className="font-display text-4xl font-extrabold leading-none tracking-tight sm:text-5xl text-fg"
        style={{ fontStretch: "125%" }}
      >
        {display}
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={isVertex}
          aria-label={ariaLabel}
          onClick={toggle}
          disabled={!provider || pending}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            isVertex
              ? "bg-accent border-accent"
              : "bg-[var(--bg-2)] border-[var(--line)]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
              isVertex ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute">
          {sub}
        </span>
      </div>
    </div>
  );
}
