import Link from "next/link";
import { ListenerCount } from "./ListenerCount";
import { InstagramIcon, TikTokIcon, YouTubeIcon, XIcon } from "./Icons";

const SOCIALS = [
  { label: "Instagram", href: "https://www.instagram.com/numa.radio/", Icon: InstagramIcon },
  { label: "TikTok", href: "https://www.tiktok.com/@numaradio", Icon: TikTokIcon },
  { label: "YouTube", href: "https://www.youtube.com/@numaradio", Icon: YouTubeIcon },
  { label: "X", href: "https://x.com/NumaRadio", Icon: XIcon },
];

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
            <div className="footer-socials">
              {SOCIALS.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="f-social"
                >
                  <Icon />
                </a>
              ))}
            </div>
          </div>
          <div className="footer-col">
            <div className="label">The Station</div>
            <ul>
              <li><a href="/#now">Now Playing</a></li>
              <li><a href="/#schedule">Schedule</a></li>
              <li><a href="/#format">The Format</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <div className="label">Listener</div>
            <ul>
              <li><a href="/#requests">Send a Request</a></li>
              <li><Link href="/add-to-home-screen">Add to Home Screen</Link></li>
            </ul>
          </div>
          <div className="footer-col">
            <div className="label">Station</div>
            <ul>
              <li><Link href="/about">About Lena</Link></li>
              <li><Link href="/submit">Submit Music</Link></li>
              <li><Link href="/privacy">Privacy</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-base">
          <span>© 2026 Numa Radio · Broadcasting from everywhere</span>
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
