"use client";

import Link from "next/link";
import { RequestForm } from "./RequestForm";
import { ShoutoutWall } from "./ShoutoutWall";

export function Requests() {
  return (
    <section className="requests" id="requests">
      <div className="shell">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              02 — The Wall
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
          <div className="req-form-card">
            <h3>
              Request the<br />next moment.
            </h3>
            <p className="hint">
              Describe a moment — Numa writes you a song. Or send Lena a
              shoutout to read on air.
            </p>

            <RequestForm />

            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px dashed var(--line)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--fg-mute)",
              }}
            >
              Got finished music?{" "}
              <Link
                href="/submit"
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                Submit it here →
              </Link>
            </div>
          </div>

          <ShoutoutWall />
        </div>
      </div>
    </section>
  );
}
