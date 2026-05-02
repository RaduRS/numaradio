import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../_components/Nav";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = {
  title: "Privacy — Numa Radio",
  description:
    "What Numa Radio collects, who it shares with, how long it keeps things, and how to get yours back. No accounts, no ads, no tracking.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy — Numa Radio",
    description:
      "What Numa Radio collects, who it shares with, how long it keeps things, and how to get yours back. No accounts, no ads, no tracking.",
    url: "https://numaradio.com/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <>
      <Nav />

      <section className="install-hero">
        <div className="shell">
          <Link className="back" href="/">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ width: 12, height: 12 }}
            >
              <path d="M13 4l-6 6 6 6" />
            </svg>
            Back to Numa Radio
          </Link>
          <div className="eyebrow" style={{ marginBottom: 24 }}>
            Housekeeping · Privacy
          </div>
          <h1>
            What we<br />
            <span className="accent">store.</span>
          </h1>
          <p className="lead">
            No accounts, no ads, no tracking pixels, no fingerprinting.
            What we do collect, what we do with it, and how to get it
            removed — written so a person can read it, not a lawyer.
          </p>
          <p
            className="lead"
            style={{ marginTop: 16, fontSize: 14, color: "var(--fg-mute)" }}
          >
            Last updated: 2026-04-27. Run by Numa Radio · contact{" "}
            <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
              hello@numaradio.com
            </a>
            .
          </p>
        </div>
      </section>

      {/* 01 — Browser-side */}
      <PrivacyBlock
        eyebrow="01 — In your browser"
        title="One ID. Your volume. That's it."
      >
        <p>
          When you open the site we save a few things in your browser&apos;s
          localStorage:
        </p>
        <ul style={listStyle}>
          <li>
            <code style={codeStyle}>numa.sid</code> — a random UUID. One per
            browser, never per tab. Used to count concurrent listeners and
            remember which tracks you&apos;ve voted on. Has no link to you
            as a person.
          </li>
          <li>
            <code style={codeStyle}>numa.volume</code>,{" "}
            <code style={codeStyle}>numa.muted</code> — your player settings.
          </li>
          <li>
            <code style={codeStyle}>numa.shoutout.last</code>,{" "}
            <code style={codeStyle}>numa.song.pending</code> — short-lived
            (5–10 min) recovery tokens for in-flight booth submissions.
            Auto-expire.
          </li>
        </ul>
        <p>
          We do <strong style={{ color: "var(--fg)" }}>not</strong> set
          tracking cookies. We don&apos;t read your canvas, fonts, audio
          context, or anything else fingerprintable.
        </p>
        <p>
          Clear site data for numaradio.com in your browser settings and all
          of the above is gone instantly.
        </p>
      </PrivacyBlock>

      {/* 02 — Server-side */}
      <PrivacyBlock
        eyebrow="02 — On our server"
        title="Hashed IPs. No raw addresses."
      >
        <p>
          When you submit something — a shoutout, a song request, a music
          upload — we record a one-way hash of your IP address (SHA-256
          with a server-side salt, truncated to 32 hex chars). This
          can&apos;t be reversed back to your IP, but it lets us rate-limit
          abuse from a single source.
        </p>
        <p>
          We never store the raw IP. Standard server access logs at our
          hosting providers (Vercel for the site, Cloudflare for the CDN
          edge) keep IPs for short rolling windows under their own
          retention policies — those aren&apos;t under our direct control.
        </p>
        <p>
          The hashed IP lives on the table that holds the thing you sent
          (your shoutout, your song request, your upload). Retention windows
          are listed in section 03 below.
        </p>
      </PrivacyBlock>

      {/* 03 — Things you send us */}
      <PrivacyBlock
        eyebrow="03 — Things you send us"
        title="Your votes, requests, shoutouts, and uploads."
      >
        <p>
          <strong style={{ color: "var(--fg)" }}>Votes.</strong> When you
          thumbs-up or thumbs-down a track, we record{" "}
          <em>(track, your numa.sid, up or down)</em>. No IP, no name. Used
          to remember your vote on the next page load and to influence
          rotation. Kept while the track is in the catalog.
        </p>
        <p>
          <strong style={{ color: "var(--fg)" }}>Listener counts.</strong>{" "}
          Every 30 seconds while the tab is visible, your browser pings the
          server with your <code style={codeStyle}>numa.sid</code>. Rows
          older than two minutes are deleted automatically.
        </p>
        <p>
          <strong style={{ color: "var(--fg)" }}>Shoutouts.</strong> The text
          you write, the optional name you give, and your hashed IP. Aired
          shoutouts stay on the catalog (so listeners can scroll the wall).
          Shoutouts that didn&apos;t make it to air —{" "}
          <em>blocked, held, or failed to deliver</em> — are deleted after
          90 days.
        </p>
        <p>
          <strong style={{ color: "var(--fg)" }}>Song requests.</strong> Your
          prompt, your handle, and your hashed IP. If we generated a track
          from your prompt and aired it, the request stays linked to that
          track. Requests that didn&apos;t result in an aired track are
          deleted after 90 days.
        </p>
        <p>
          <strong style={{ color: "var(--fg)" }}>Music submissions</strong>{" "}
          (artists). Your name, email, the audio file, optional cover art,
          and your hashed IP. Lifecycle:
        </p>
        <ul style={listStyle}>
          <li>
            <strong style={{ color: "var(--fg)" }}>While pending:</strong>{" "}
            audio + metadata sit in our submission storage waiting for
            review.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>If we approve:</strong>{" "}
            audio moves into the broadcast catalog under a new asset row,
            the submission&apos;s storage copy is deleted. Your name and
            email stay on the submission record so we can reach you.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>If we reject:</strong>{" "}
            audio + cover are deleted from B2 immediately. The row stays
            with the rejection reason for 30 days, then is permanently
            deleted.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>If you withdraw:</strong>{" "}
            see section 06.
          </li>
        </ul>
      </PrivacyBlock>

      {/* 04 — Where your data goes */}
      <PrivacyBlock
        eyebrow="04 — Who else sees it"
        title="A short list of processors."
      >
        <p>
          We don&apos;t sell, share, or export your data for advertising or
          analytics. We do route some of it through services that help us
          run the station — listed here in full, with what each one sees:
        </p>
        <ul style={listStyle}>
          <li>
            <strong style={{ color: "var(--fg)" }}>MiniMax</strong> (China,
            US edge). Receives the text of your shoutouts and song requests
            for moderation and rewriting, and the text prompt for AI music
            generation. Receives the optional sender name. Doesn&apos;t see
            your IP, your hashed IP, or anything else.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Deepgram</strong> (US).
            Receives the final on-air script (rewritten by us) and returns
            the synthesised voice. No personal info.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Brave Search</strong>{" "}
            (US). Receives generic topic queries the host uses for context
            (e.g. &ldquo;weather Tokyo today&rdquo;). Never receives your
            content.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>OpenRouter</strong> (US).
            Receives album-art prompts for AI image generation when a song
            request is made. Never receives your name, email, or IP.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Backblaze B2</strong>{" "}
            (Frankfurt, EU). Stores the audio files and album artwork —
            yours and ours.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Vercel</strong> (US,
            global edge). Hosts the site you&apos;re on. Sees standard
            server access logs.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Cloudflare</strong> (US,
            global edge). CDN + access control. Sees standard server access
            logs.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Neon</strong> (EU,
            Postgres). The database that holds the rows described in
            sections 02 and 03.
          </li>
        </ul>
        <p>
          Some of these are outside the EEA. By submitting content through
          the site you&apos;re aware it may transit non-EEA infrastructure.
          We don&apos;t use any of them for advertising, profiling, or
          building a profile on you.
        </p>
      </PrivacyBlock>

      {/* 05 — Your rights */}
      <PrivacyBlock
        eyebrow="05 — Your rights"
        title="Access. Erasure. Done within 7 days."
      >
        <p>
          You can ask us to:
        </p>
        <ul style={listStyle}>
          <li>
            <strong style={{ color: "var(--fg)" }}>Tell you what we have</strong> —
            send an email; we&apos;ll write back with everything tied to
            your IP-hash, your <code style={codeStyle}>numa.sid</code>{" "}
            (paste it from devtools → Application → Local Storage), or your
            email address.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Delete what we have</strong> —
            same email, we&apos;ll wipe it. For uploaded music, we
            distinguish withdrawal from full deletion — see section 06.
          </li>
          <li>
            <strong style={{ color: "var(--fg)" }}>Correct what we have</strong> —
            mistyped your name on a submission? Email us, we&apos;ll fix
            it.
          </li>
        </ul>
        <p>
          Email{" "}
          <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
            hello@numaradio.com
          </a>{" "}
          for any of the above. We aim to respond within 7 days.
        </p>
        <p>
          If you&apos;re in the EU/UK and unhappy with how we&apos;ve
          handled a request, you can lodge a complaint with your national
          supervisory authority — but please give us a chance to fix it
          first.
        </p>
      </PrivacyBlock>

      {/* 06 — Submissions */}
      <section
        id="submissions"
        style={{ padding: "72px 0", borderTop: "1px solid var(--line)" }}
      >
        <div className="shell">
          <div
            className="about-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.6fr",
              gap: 64,
              alignItems: "start",
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 20 }}>
                06 — Submitting music
              </div>
              <h2 style={titleStyle}>
                What you&apos;re<br />agreeing to.
              </h2>
            </div>
            <div style={bodyStyle}>
              <p>
                When you upload a track to Numa Radio you confirm:
              </p>
              <ul style={listStyle}>
                <li>
                  The recording and the composition are your work, or you
                  have all rights to broadcast them.
                </li>
                <li>
                  You authorise Numa Radio to air the track on its 24/7
                  audio stream{" "}
                  <strong style={{ color: "var(--fg)" }}>
                    and on its public YouTube simulcast
                  </strong>{" "}
                  (the same broadcast, mirrored to YouTube Live so listeners
                  can watch on the YouTube channel as well as listen via the
                  audio stream). If your rights deal with a label or
                  distributor restricts YouTube distribution, please don&apos;t
                  submit.
                </li>
                <li>
                  You&apos;re solely responsible for the rights status of
                  what you submit. Numa Radio is not liable for disputes
                  arising from material you upload that turns out not to
                  be yours to share — including any YouTube Content ID
                  claims.
                </li>
              </ul>

              <p style={{ marginTop: 8 }}>
                <strong style={{ color: "var(--fg)" }}>Withdrawing your track.</strong>{" "}
                Email{" "}
                <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
                  hello@numaradio.com
                </a>{" "}
                and we&apos;ll pull it from rotation within 48 hours. What
                happens to your contact info depends on the lane you
                chose at submit time:
              </p>
              <ul style={listStyle}>
                <li>
                  <strong style={{ color: "var(--fg)" }}>Permanent rotation.</strong>{" "}
                  We pull the track and delete the audio. Your name + email
                  stay on the (now-withdrawn) record so we can reach back
                  out — for example, if we lose the file and want to ask
                  whether you&apos;d like to re-submit.
                </li>
                <li>
                  <strong style={{ color: "var(--fg)" }}>One-off airing.</strong>{" "}
                  We pull the track and delete the audio AND scrub your
                  name + email from the record. Only an anonymised audit
                  row remains.
                </li>
                <li>
                  <strong style={{ color: "var(--fg)" }}>Total erasure.</strong>{" "}
                  Either lane — say so explicitly in your email and
                  we&apos;ll wipe the row, the track, and every
                  associated asset. Nothing of yours stays on our side.
                </li>
              </ul>

              <p style={{ marginTop: 8 }}>
                <strong style={{ color: "var(--fg)" }}>Copyright complaints.</strong>{" "}
                If you believe a track on the station infringes your
                rights, email{" "}
                <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
                  hello@numaradio.com
                </a>{" "}
                with the URL of the track, your contact details, and a
                statement that you own (or represent the owner of) the
                copyrighted work. We act on these within 24 hours.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 800,
  fontStretch: "125%",
  fontSize: "clamp(28px, 3.4vw, 44px)",
  lineHeight: 0.95,
  letterSpacing: "-0.02em",
  textTransform: "uppercase",
};

const bodyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  color: "var(--fg-dim)",
  fontSize: 16,
  lineHeight: 1.55,
  maxWidth: 620,
};

const listStyle: React.CSSProperties = {
  paddingLeft: 22,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 4,
};

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  color: "var(--fg)",
  background: "var(--bg-2)",
  padding: "1px 6px",
  borderRadius: 4,
};

function PrivacyBlock({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ padding: "72px 0", borderTop: "1px solid var(--line)" }}
    >
      <div className="shell">
        <div
          className="about-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr",
            gap: 64,
            alignItems: "start",
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 20 }}>
              {eyebrow}
            </div>
            <h2 style={titleStyle}>{title}</h2>
          </div>
          <div style={bodyStyle}>{children}</div>
        </div>
      </div>
    </section>
  );
}
