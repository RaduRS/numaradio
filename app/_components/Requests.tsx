"use client";

import { useEffect, useState } from "react";
import { MegaphoneIcon, MusicNoteIcon, SendIcon, CopyIcon, BlueskyIcon } from "./Icons";

// Two request types only: Song + Shoutout. Suno-link tab dropped per
// Decisions Log 2026-04-19 — listener-pasted URLs can't be rights-verified.
type Tab = "song" | "shout";

const REVIEW_LINES = [
  "Requests are reviewed live on air — Lena picks what fits the moment.",
  "Anything unsafe gets quietly dropped — we keep the station clean.",
  "Not every submission is guaranteed to play.",
];

export function Requests() {
  const [tab, setTab] = useState<Tab>("song");
  const [reviewIdx, setReviewIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendLabel, setSendLabel] = useState("Send to the booth");

  useEffect(() => {
    const id = setInterval(
      () => setReviewIdx((i) => (i + 1) % REVIEW_LINES.length),
      4_200,
    );
    return () => clearInterval(id);
  }, []);

  // TODO Phase 5: POST to /api/requests or /api/shoutouts. Stub for now.
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendLabel("✓ In the queue");
    setTimeout(() => {
      setSendLabel("Send another");
      setSending(false);
    }, 1_600);
  }

  return (
    <section className="requests" id="requests">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              04 — The Wall
            </div>
            <h2>
              Send it<br />to Lena.
            </h2>
          </div>
          <p className="lead">
            Requests get read. Shoutouts get landed. Love notes, breakup notes,
            &ldquo;I need to hear this right now&rdquo; notes — they all go in the
            same queue. Lena picks what fits the moment.
          </p>
        </div>

        <div className="req-wall">
          {/* Form */}
          <div className="req-form-card">
            <h3>
              Request the<br />next moment.
            </h3>
            <p className="hint">
              Describe a moment — Numa writes you a song. Or send Lena a
              shoutout to read on air.
            </p>

            <div className="req-types" role="tablist">
              <button
                className={`req-type ${tab === "song" ? "active" : ""}`}
                onClick={() => setTab("song")}
                role="tab"
                aria-selected={tab === "song"}
              >
                <span className="rt-ico">
                  <MusicNoteIcon className="" />
                </span>
                <span className="rt-label">Song request</span>
              </button>
              <button
                className={`req-type ${tab === "shout" ? "active" : ""}`}
                onClick={() => setTab("shout")}
                role="tab"
                aria-selected={tab === "shout"}
              >
                <span className="rt-ico">
                  <MegaphoneIcon className="" />
                </span>
                <span className="rt-label">Shoutout</span>
              </button>
            </div>

            <form onSubmit={submit}>
              {tab === "song" ? (
                <div className="req-input-group">
                  <input
                    className="req-input"
                    placeholder="A vibe, a mood, a moment — Numa makes it into a song"
                  />
                  <input className="req-input" placeholder="Your name or city" />
                  <textarea
                    className="req-input req-textarea"
                    placeholder="Anything for Lena? (optional)"
                  />
                </div>
              ) : (
                <div className="req-input-group">
                  <input className="req-input" placeholder="Who it's for…" />
                  <input className="req-input" placeholder="Your name or city" />
                  <textarea
                    className="req-input req-textarea"
                    placeholder="Your message — keep it short so we get through more."
                  />
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary req-send"
                disabled={sending}
              >
                <span>{sendLabel}</span>
                <SendIcon className="btn-icon" />
              </button>
            </form>

            <div className="req-review">
              <div className="rev-rotator">
                {REVIEW_LINES.map((line, i) => (
                  <div
                    key={i}
                    className={`rev-line ${i === reviewIdx ? "active" : ""}`}
                  >
                    <span className={`dot ${i === 0 ? "" : "soft"}`} />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="req-tickers">
              <span className="dot">●</span>
              <span>Queue length · 14</span>
              <span style={{ color: "var(--fg-mute)" }}>—</span>
              <span>Avg wait · 9 min</span>
            </div>
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: "1px dashed var(--line)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--fg-mute)",
              }}
            >
              Got finished music?{" "}
              <a
                href="/submit"
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                Submit it here →
              </a>
            </div>
          </div>

          {/* Shoutout column 1 */}
          <div className="shout-col">
            <div className="shout-card featured">
              <div className="shout-head">
                <div className="shout-avatar">M</div>
                <div className="shout-meta">
                  <div className="shout-name">Mika — Osaka</div>
                  <div className="shout-time">02:41 AM · Local</div>
                </div>
                <div className="shout-tag live">On Air</div>
              </div>
              <div className="shout-text">
                &ldquo;can you tell my sister happy birthday? she&apos;s on night
                shift and she loves you.&rdquo;
              </div>
              <div className="shout-track">
                <span className="ico" />
                <span className="tt">Worn Halo</span>
                <span className="sep">·</span>
                <span className="ta">Russell Ross</span>
              </div>
              <div className="shout-reply">
                <div className="rep-stamp">
                  <span className="rep-dot" />
                  Lena
                </div>
                <div className="rep-text">
                  <span className="q">&ldquo;Mika, you beautiful human.&rdquo;</span>
                  Happy birthday Yuki — Russell&apos;s got one queued up just for
                  you, at 2:51.
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px dashed var(--line)",
                }}
              >
                <button className="shout-share" title="Copy link">
                  <CopyIcon className="" />
                  Copy link
                </button>
                <button className="shout-share" title="Share to Bluesky">
                  <BlueskyIcon className="" />
                  Share
                </button>
              </div>
            </div>

            <div className="shout-card">
              <div className="shout-head">
                <div className="shout-avatar c2">R</div>
                <div className="shout-meta">
                  <div className="shout-name">Reza — Tehran</div>
                  <div className="shout-time">11:14 AM · Local</div>
                </div>
                <div className="shout-tag">Queued · 3</div>
              </div>
              <div className="shout-text">
                &ldquo;first coffee, first sunlight. play something that sounds
                like the city waking up.&rdquo;
              </div>
              <div className="shout-track">
                <span
                  className="ico"
                  style={{ background: "var(--fg-mute)", boxShadow: "none" }}
                />
                <span className="tt">Morning Room</span>
                <span className="sep">·</span>
                <span className="ta">Russell Ross</span>
              </div>
            </div>
          </div>

          {/* Shoutout column 2 */}
          <div className="shout-col">
            <div className="shout-card">
              <div className="shout-head">
                <div className="shout-avatar c3">J</div>
                <div className="shout-meta">
                  <div className="shout-name">June — Brooklyn</div>
                  <div className="shout-time">02:38 AM · Local</div>
                </div>
                <div className="shout-tag">Played · 02:42</div>
              </div>
              <div className="shout-text">
                &ldquo;lena, we&apos;re on the fire escape again. send us off into
                sleep.&rdquo;
              </div>
              <div className="shout-track">
                <span
                  className="ico"
                  style={{ background: "var(--fg-mute)", boxShadow: "none" }}
                />
                <span className="tt">Copperline</span>
                <span className="sep">·</span>
                <span className="ta">Russell Ross</span>
              </div>
            </div>

            <div className="shout-card">
              <div className="shout-head">
                <div className="shout-avatar c4">N</div>
                <div className="shout-meta">
                  <div className="shout-name">Nolan — Lisbon</div>
                  <div className="shout-time">07:51 AM · Local</div>
                </div>
                <div className="shout-tag">Queued · 1</div>
              </div>
              <div className="shout-text">
                &ldquo;slow and a little heartbroken, please. it&apos;s one of those
                mornings.&rdquo;
              </div>
              <div className="shout-track">
                <span className="ico" />
                <span className="tt">Slow Fade, Brighter</span>
                <span className="sep">·</span>
                <span className="ta">Russell Ross</span>
              </div>
              <div className="shout-reply">
                <div className="rep-stamp">
                  <span className="rep-dot" />
                  Lena
                </div>
                <div className="rep-text">
                  <span className="q">&ldquo;Heard you, Nolan.&rdquo;</span>
                  Playing right now — look out the window.
                </div>
              </div>
            </div>

            <div className="shout-card">
              <div className="shout-head">
                <div className="shout-avatar c5">E</div>
                <div className="shout-meta">
                  <div className="shout-name">Elin — Göteborg</div>
                  <div className="shout-time">08:24 AM · Local</div>
                </div>
                <div className="shout-tag">Queued · 6</div>
              </div>
              <div className="shout-text">
                &ldquo;commute request — something with teeth. thanks.&rdquo;
              </div>
              <div className="shout-track">
                <span
                  className="ico"
                  style={{ background: "var(--fg-mute)", boxShadow: "none" }}
                />
                <span className="tt">Tunnel 61</span>
                <span className="sep">·</span>
                <span className="ta">Russell Ross</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
