import Link from "next/link";
import { Logo } from "./Logo";
import { ListenLiveButton } from "./ListenLiveButton";

export function Nav() {
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
            <span className="dot" /> On Air
          </div>
          <ListenLiveButton size="sm" />
        </div>
      </div>
    </nav>
  );
}
