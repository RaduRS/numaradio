import { ListenerCount } from "./ListenerCount";
import {
  BlueskyIcon,
  InstagramIcon,
  MastodonIcon,
  RssIcon,
} from "./Icons";

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer-grid">
          <div className="footer-brand">
            <h4>
              Numa·Radio
              <br />
              <span
                style={{
                  color: "var(--accent)",
                  fontStyle: "italic",
                  fontStretch: "100%",
                }}
              >
                never sleeps.
              </span>
            </h4>
            <p>
              An always-on internet radio station. Hosted by Lena. Powered by
              late nights, listener requests, and a deep respect for the one
              good song you haven&apos;t heard yet.
            </p>
          </div>
          <div className="footer-col">
            <div className="label">The Station</div>
            <ul>
              <li><a href="#now">Now Playing</a></li>
              <li><a href="#schedule">Schedule</a></li>
              <li><a href="#format">The Format</a></li>
              <li><a href="#">Recently Played</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <div className="label">Listener</div>
            <ul>
              <li><a href="#requests">Send a Request</a></li>
              <li><a href="#">Shoutouts</a></li>
              <li><a href="/add-to-home-screen">Add to Home Screen</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <div className="label">Station</div>
            <ul>
              <li><a href="#">About Lena</a></li>
              <li><a href="#">Submit Music</a></li>
              <li><a href="#">Press Kit</a></li>
              <li><a href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-base">
          <span>© 2026 Numa Radio · Broadcasting from everywhere</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <a href="#" className="f-social" aria-label="Bluesky">
              <BlueskyIcon className="" />
            </a>
            <a href="#" className="f-social" aria-label="Instagram">
              <InstagramIcon className="" />
            </a>
            <a href="#" className="f-social" aria-label="Mastodon">
              <MastodonIcon className="" />
            </a>
            <a href="#" className="f-social" aria-label="RSS">
              <RssIcon className="" />
            </a>
          </span>
          <span className="f-live">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent)",
                boxShadow: "0 0 8px var(--accent-glow)",
                display: "inline-block",
                animation: "pulseDot 2s ease-in-out infinite",
              }}
            />{" "}
            Streaming now · <ListenerCount suffix=" listening" />
          </span>
        </div>
      </div>
    </footer>
  );
}
