export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-12">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-accent"
          >
            <span
              className="block h-2 w-2 rounded-full bg-accent"
              style={{
                boxShadow: "0 0 12px var(--accent-glow)",
                animation: "numa-pulse 2.2s ease-in-out infinite",
              }}
            />
          </span>
          <span
            className="font-display text-2xl font-extrabold uppercase tracking-wide"
            style={{ fontStretch: "125%" }}
          >
            Numa<span className="text-accent">·</span>Radio
          </span>
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          On air soon.
        </p>
      </div>
    </main>
  );
}
