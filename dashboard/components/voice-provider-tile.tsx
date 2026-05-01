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

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!provider || pending}
      title={
        provider
          ? `Click to swap to ${provider === "deepgram" ? "Leda · google" : "Helena · deepgram"}`
          : "Loading voice provider…"
      }
      className={`flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg-1)] px-4 py-3.5 sm:px-5 sm:py-4 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-60 ${
        pending ? "opacity-70" : ""
      }`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
        Voice
      </span>
      <span
        className="font-display text-4xl font-extrabold leading-none tracking-tight sm:text-5xl text-fg"
        style={{ fontStretch: "125%" }}
      >
        {display}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute">
        {sub}
      </span>
    </button>
  );
}
