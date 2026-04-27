import Link from "next/link";
import { ListenLiveButton } from "./ListenLiveButton";
import { ChevronUpRightArrow } from "./Icons";
import { Phone1Mockup } from "./Phone1Mockup";
import { Phone2Mockup } from "./Phone2Mockup";

// The two phone mockups are a lot of inline SVG + gradient markup. Kept close
// to the design HTML intentionally — JSX is a mechanical translation, not a
// rewrite. Don't refactor into deeper components.

export function Mobile() {
  return (
    <section className="mobile-showcase">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              06 — In Your Pocket
            </div>
            <h2>
              Open it in<br />a browser.<br />Or don&apos;t.
            </h2>
          </div>
          <p className="lead">
            Numa lives on the open web — no app store, no download, no
            gatekeeping. Open the site on your phone and hit play. Want it on
            your home screen? Tap <em>Add to Home Screen</em> and it behaves
            like any other app: full-bleed, lock-screen controls, instant
            launch.
          </p>
        </div>

        <div className="mobile-grid">
          <div className="mobile-copy">
            <div className="mobile-feats">
              <div className="mobile-feat">
                <div className="mobile-feat-num">01</div>
                <div className="mobile-feat-body">
                  <h4>Open and play</h4>
                  <p>
                    No install, no signup. Visit numaradio.com on any phone and
                    the play button is the first thing you see.
                  </p>
                </div>
              </div>
              <div className="mobile-feat">
                <div className="mobile-feat-num">02</div>
                <div className="mobile-feat-body">
                  <h4>Add to Home Screen</h4>
                  <p>
                    Save Numa to your home screen and it launches full-bleed, no
                    browser chrome. Feels like an app. Isn&apos;t one.
                  </p>
                </div>
              </div>
              <div className="mobile-feat">
                <div className="mobile-feat-num">03</div>
                <div className="mobile-feat-body">
                  <h4>Keeps playing in the background</h4>
                  <p>
                    Lock your phone, switch tabs, check a text. Audio keeps
                    going, with track metadata on your lock screen.
                  </p>
                </div>
              </div>
            </div>
            <div className="hero-ctas" style={{ marginBottom: 0 }}>
              <ListenLiveButton />
              <Link className="btn btn-ghost" href="/add-to-home-screen">
                <ChevronUpRightArrow className="btn-icon" />
                How to Add to Home Screen
              </Link>
            </div>
          </div>

          <div className="phones">
            <Phone1Mockup />
            <Phone2Mockup />
          </div>
        </div>
      </div>
    </section>
  );
}
