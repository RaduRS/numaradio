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
              Request a Song
            </a>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="n">
                18<span className="unit">hrs</span>
              </div>
              <div className="l">Since last silence</div>
            </div>
            <div className="hero-stat">
              <div className="n">1,204</div>
              <div className="l">Tracks this week</div>
            </div>
            <div className="hero-stat">
              <div className="n">87</div>
              <div className="l">Requests tonight</div>
            </div>
          </div>
        </div>

        <div className="hero-right">
          <PlayerCard />
        </div>
      </div>
    </section>
  );
}
