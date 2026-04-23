"use client";

import { useEffect, useState } from "react";
import { SHOW_SCHEDULE, showForHour } from "@/lib/schedule";

export function Schedule() {
  // Start as null so SSR output is deterministic (no Live Now pill). Client
  // resolves to the active slot on mount and refreshes every minute.
  const [nowIndex, setNowIndex] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      const active = showForHour(new Date().getHours());
      setNowIndex(SHOW_SCHEDULE.indexOf(active));
    };
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
          {SHOW_SCHEDULE.map((s, i) => (
            <div key={i} className={`show-card ${i === nowIndex ? "now" : ""}`}>
              <div className="show-time">
                {i === nowIndex ? (
                  <>
                    <span className="live">● Live Now</span>
                    <span>·</span>
                    <span>{s.timeLabel}</span>
                  </>
                ) : (
                  <span>{s.timeLabel}</span>
                )}
              </div>
              <div className="show-desc">{s.description}</div>
              <div className="show-title">
                {s.titleLines[0]}
                <br />
                {s.titleLines[1]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
