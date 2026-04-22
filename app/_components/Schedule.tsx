"use client";

import { useEffect, useState } from "react";

const SHOWS = [
  {
    time: "00 – 05",
    title: ["Night", "Shift"],
    desc:
      "Quiet-hours rotation. Low-BPM, spacious, voices that don't shout. Lena whispers. Mostly.",
  },
  {
    time: "05 – 10",
    title: ["Morning", "Room"],
    desc:
      "First coffee energy. Warmer tones, field recordings, the occasional cover of something you'd forgotten.",
  },
  {
    time: "10 – 17",
    title: ["Daylight", "Channel"],
    desc:
      "Focus-hours programming. Longer tracks, fewer host breaks. Good for writing, commuting, staring out.",
  },
  {
    time: "17 – 24",
    title: ["Prime", "Hours"],
    desc:
      "Dinner to midnight. Louder, stranger, more character. The request wall runs hottest here.",
  },
];

function slotForHour(h: number): number {
  if (h < 5) return 0;
  if (h < 10) return 1;
  if (h < 17) return 2;
  return 3;
}

export function Schedule() {
  // Start as null so SSR output is deterministic (no Live Now pill). Client
  // resolves to the active slot on mount and refreshes every minute.
  const [nowIndex, setNowIndex] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNowIndex(slotForHour(new Date().getHours()));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="schedule" id="schedule">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              05 — The Week
            </div>
            <h2>
              Always on.<br />Different<br />every hour.
            </h2>
          </div>
          <p className="lead">
            The station has moods. Late nights go soft. Mornings wake up slow.
            Weekends get a little louder. Here&apos;s the rhythm, roughly, though
            Lena always reserves the right to change her mind.
          </p>
        </div>

        <div className="sched-grid">
          {SHOWS.map((s, i) => (
            <div key={i} className={`show-card ${i === nowIndex ? "now" : ""}`}>
              <div className="show-time">
                {i === nowIndex ? (
                  <>
                    <span className="live">● Live Now</span>
                    <span>·</span>
                    <span>{s.time}</span>
                  </>
                ) : (
                  <span>{s.time}</span>
                )}
              </div>
              <div className="show-desc">{s.desc}</div>
              <div className="show-title">
                {s.title[0]}
                <br />
                {s.title[1]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
