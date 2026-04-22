import { ListenLiveButton } from "./ListenLiveButton";
import { ListenerCount } from "./ListenerCount";
import { SparklesIcon } from "./Icons";
import { PlayerCard } from "./PlayerCard";

export function Hero() {
  return (
    <section className="hero">
      <div className="shell hero-grid">
        <div className="hero-left">
          <div className="hero-meta">
            <span>EST. 2026</span>
            <span className="sep" />
            <span>24 / 7 / FOREVER</span>
            <span className="sep" />
            <span>
              <ListenerCount suffix=" listening now" />
            </span>
          </div>
          <h1>
            The station<br />
            that <span className="accent-word">never</span><br />
            sleeps.
          </h1>
          <p className="hero-sub">
            <strong>Numa Radio</strong> is always-on AI radio — fresh tracks,
            live energy, and listener requests, hosted by <strong>Lena</strong>,
            who&apos;s been on the mic since 11pm and isn&apos;t planning to stop.
          </p>
          <div className="hero-ctas">
            <ListenLiveButton />
            <a className="btn btn-ghost" href="#requests">
              <SparklesIcon className="btn-icon" />
              Send it to Lena
            </a>
          </div>
        </div>

        <div className="hero-right">
          <PlayerCard />
        </div>
      </div>
    </section>
  );
}
