"use client";
// POLLING DISABLED — DB is down, no live data.

import { useFallbackArtworkUrl } from "./FallbackArtworkProvider";
import { Skeleton } from "./Skeleton";
import { Waveform } from "./Waveform";
import { ShareControls } from "./ShareControls";
import { VoteButtons } from "./VoteButtons";

function initials(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "··";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Static placeholder data for presentation mode
const PLACEHOLDER_TITLE = "Numa Radio";
const PLACEHOLDER_ARTIST = "AI-Powered Radio";

export function Broadcast() {
  const fallback = useFallbackArtworkUrl();
  const artBg = `url(${fallback})`;

  return (
    <section className="broadcast" id="now">
      <div className="shell">
        <div className="broadcast-head">
          <div className="eyebrow">04 — The Booth</div>
          <h2>The booth.</h2>
          <p className="broadcast-sub">
            Stream offline — static presentation mode.
          </p>
        </div>

        <div className="broadcast-grid">
          <div className="broadcast-now">
            <div
              className="broadcast-art"
              style={{
                backgroundImage: artBg,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <span className="art-share">
                <ShareControls />
              </span>
              <span className="art-vote">
                <VoteButtons trackId={undefined} />
              </span>
            </div>
            <div className="now-track-lg">
              <div className="title">{PLACEHOLDER_TITLE}</div>
              <div className="sub">{PLACEHOLDER_ARTIST}</div>
            </div>
            <div style={{ marginTop: 28 }}>
              {/* <Waveform
                hasTrack={false}
                progress={0}
                elapsedSeconds={0}
                durationSeconds={null}
                showTime
              /> */}
            </div>
          </div>

          <div className="broadcast-next">
            <div className="up-next-head">
              <h3>Just Played</h3>
            </div>
            <div className="queue-list">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="queue-item" aria-hidden="true">
                  <div className="q-pos">
                    <Skeleton width={20} height={11} radius={3} />
                  </div>
                  <div className="q-art">
                    <Skeleton width={56} height={56} radius={6} />
                  </div>
                  <div className="q-info">
                    <Skeleton width="65%" height={14} radius={4} style={{ marginBottom: 6 }} />
                    <Skeleton width="40%" height={11} radius={3} />
                  </div>
                  <div className="q-dur">
                    <Skeleton width={36} height={11} radius={3} />
                  </div>
                  <div />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}