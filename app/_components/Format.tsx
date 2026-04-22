export function Format() {
  return (
    <section className="format" id="format">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              03 — The Format
            </div>
            <h2>
              Not a<br />playlist.
            </h2>
          </div>
          <p className="lead">
            Three things happen here, on a loop, forever. Music moves, Lena comes
            back between tracks, and you can shape what plays next — from
            anywhere, in real time. No ads. No algorithm-of-the-day. Just a
            station with a pulse.
          </p>
        </div>

        <div className="format-flow">
          <div className="flow-cell">
            <div className="step">
              <span className="step-num">01</span>
              <span>Music</span>
            </div>
            <h3>
              Plays<br />continuously.
            </h3>
            <div className="desc">
              Fresh tracks, hand-curated and threaded together so you hear
              something you loved, then something you didn&apos;t know you&apos;d love.
            </div>
            <div className="flow-viz">
              <div className="viz-wave">
                {[40, 70, 90, 60, 85, 45, 75, 55, 95, 65, 80, 50, 70, 90, 60].map(
                  (h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h}%`, animationDelay: `-${0.1 + i * 0.05}s` }}
                    />
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="flow-cell">
            <div className="step">
              <span className="step-num">02</span>
              <span>The Host</span>
            </div>
            <h3>
              Lena steps in.<br />Between<br />songs.
            </h3>
            <div className="desc">
              She&apos;ll read your name, riff on the track, tell you what&apos;s coming,
              maybe a story. Never a monologue — just enough.
            </div>
            <div className="flow-viz">
              <div className="viz-mic">
                <div className="ring" />
                <div className="ring" />
                <div className="ring" />
                <div className="dot-core" />
              </div>
            </div>
          </div>

          <div className="flow-cell">
            <div className="step">
              <span className="step-num">03</span>
              <span>Requests</span>
            </div>
            <h3>
              You<br />shape the<br />next hour.
            </h3>
            <div className="desc">
              Every request you send lands in Lena&apos;s queue. If it fits the
              moment, the whole station hears it with you.
            </div>
            <div className="flow-viz">
              <div className="viz-req">
                <div className="bubble" />
                <div className="bubble on" />
                <div className="bubble" />
                <div className="bubble" />
                <div className="bubble on" />
                <div className="bubble" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
