// TODO Phase 4: replace placeholder queue + now-playing with /api/station/now-playing
// + /api/station/upcoming responses.

const QUEUE = [
  {
    pos: "01",
    art: "T6",
    artVariant: "v2",
    title: "Tunnel 61",
    artist: "Russell Ross · Kōbe tapes",
    duration: "04:18",
    tag: "Request",
  },
  {
    pos: "02",
    art: "DS",
    artVariant: "v3",
    title: "Daylight Saving",
    artist: "Russell Ross · Single",
    duration: "03:02",
  },
  {
    pos: "03",
    art: "NV",
    artVariant: "v4",
    title: "Nine Velvet",
    artist: "Russell Ross · Late Phase",
    duration: "05:44",
  },
  {
    pos: "04",
    art: "WH",
    artVariant: "v5",
    title: "Worn Halo",
    artist: "Russell Ross · b-side",
    duration: "02:51",
    tag: "Request",
  },
];

export function Broadcast() {
  return (
    <section className="broadcast" id="now">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              03 — Live Queue
            </div>
            <h2>
              Now playing.<br />Up next.
            </h2>
          </div>
          <p className="lead">
            The queue is never hidden. See what&apos;s on deck, what just dropped,
            and when Lena is scheduled to come back on — all in real time.
          </p>
        </div>

        <div className="broadcast-grid">
          <div className="broadcast-now">
            <div className="broadcast-art">
              <div className="tape">REEL 04 · SIDE B</div>
              <div className="tape-r">02:47 AM</div>
              <div className="glyph">SF</div>
            </div>
            <div className="now-track-lg">
              <div className="title">
                Slow Fade,<br />Brighter
              </div>
              <div className="sub">
                <span>Russell Ross</span>
                <span className="dot-sep" />
                <span>Nightshore EP</span>
                <span className="dot-sep" />
                <span>2025</span>
              </div>
            </div>
            <div className="progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: "62%" }} />
              </div>
              <div className="progress-labels">
                <span>02:17</span>
                <span>03:42</span>
              </div>
            </div>
          </div>

          <div className="broadcast-next">
            <div className="up-next-head">
              <h3>Coming Up</h3>
              <div className="eyebrow">Auto-updating · Live</div>
            </div>
            <div className="queue-list">
              <div className="queue-item lena-row">
                <div className="q-pos">—</div>
                <div className="q-art lena">L</div>
                <div className="q-info">
                  <div className="q-title">
                    <span className="q-tag">Host break</span>Lena reads tonight&apos;s requests
                  </div>
                  <div className="q-artist">Live mic · ~90 seconds</div>
                </div>
                <div className="q-dur">01:30</div>
                <div />
              </div>
              {QUEUE.map((item) => (
                <div key={item.pos} className="queue-item">
                  <div className="q-pos">{item.pos}</div>
                  <div className={`q-art ${item.artVariant}`}>{item.art}</div>
                  <div className="q-info">
                    <div className="q-title">{item.title}</div>
                    <div className="q-artist">{item.artist}</div>
                  </div>
                  <div className="q-dur">{item.duration}</div>
                  {item.tag ? <div className="q-tag-req">{item.tag}</div> : <div />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
