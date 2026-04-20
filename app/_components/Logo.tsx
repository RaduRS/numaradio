import Link from "next/link";

type Props = { size?: "default" | "small"; className?: string };

export function Logo({ size = "default", className = "" }: Props) {
  const fontSize = size === "small" ? "11px" : "20px";
  return (
    <Link
      href="/"
      className={`logo ${className}`}
      style={{ fontSize, textDecoration: "none", color: "inherit" }}
      aria-label="Numa Radio — home"
    >
      <span className="logo-mark" />
      <span>
        Numa<span style={{ color: "var(--accent)" }}>·</span>Radio
      </span>
    </Link>
  );
}
