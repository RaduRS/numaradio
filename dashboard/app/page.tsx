export default function OperatorDashboard() {
  return (
    <main className="flex flex-1 items-center justify-center p-12">
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          className="font-display text-3xl font-extrabold uppercase tracking-wide"
          style={{ fontStretch: "125%" }}
        >
          Numa<span className="text-accent">·</span>Radio
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Operator Dashboard · scaffolding…
        </p>
      </div>
    </main>
  );
}
