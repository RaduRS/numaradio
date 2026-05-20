"use client";
import Link from "next/link";
import { Logo } from "./Logo";
import { ListenLiveButton } from "./ListenLiveButton";
import { useEffect, useState } from "react";

export function Nav() {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function check() {
      try {
        const r = await fetch("/api/station/listeners", { cache: "no-store" });
        if (!r.ok || !mounted) return;
        const json = (await r.json()) as { isLive?: boolean };
        if (mounted) setIsLive(json.isLive ?? false);
      } catch {
        if (mounted) setIsLive(false);
      }
    }
    check();
    const id = setInterval(check, 15_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <nav className="nav">
      <div className="shell nav-inner">
        <Logo />
        <div className="nav-links">
          {/* <Link> for in-app section anchors so navigating from
              /about → /#requests stays a client-side transition with
              the Next router managing scroll restoration. */}
          <Link href="/#requests">Requests</Link>
          <Link href="/#format">The Station</Link>
          <Link href="/#now">Now Playing</Link>
          <Link href="/#schedule">Shows</Link>
          <Link href="/submit">Submit</Link>
        </div>
        <div className="nav-right">
          <div className="live-chip">
            <span className="dot" /> {isLive ? "On Air" : "Off Air"}
          </div>
          <ListenLiveButton size="sm" />
        </div>
      </div>
    </nav>
  );
}
