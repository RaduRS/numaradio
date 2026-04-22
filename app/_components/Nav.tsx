import { Logo } from "./Logo";
import { ListenLiveButton } from "./ListenLiveButton";

export function Nav() {
  return (
    <nav className="nav">
      <div className="shell nav-inner">
        <Logo />
        <div className="nav-links">
          <a href="/#requests">Requests</a>
          <a href="/#format">The Station</a>
          <a href="/#now">Now Playing</a>
          <a href="/#schedule">Shows</a>
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
