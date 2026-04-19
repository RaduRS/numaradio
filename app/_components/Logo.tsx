type Props = { size?: "default" | "small"; className?: string };

export function Logo({ size = "default", className = "" }: Props) {
  const fontSize = size === "small" ? "11px" : "20px";
  return (
    <div className={`logo ${className}`} style={{ fontSize }}>
      <span className="logo-mark" />
      <span>
        Numa<span style={{ color: "var(--accent)" }}>·</span>Radio
      </span>
    </div>
  );
}
