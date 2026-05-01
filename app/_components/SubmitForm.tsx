"use client";

import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";

type State =
  | { kind: "input" }
  | { kind: "submitting" }
  | { kind: "ok"; email: string; receivedAt: Date }
  | { kind: "error"; message: string };

const MAX_AUDIO_MB = 10;
const MAX_ART_MB = 2;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function SubmitForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [artwork, setArtwork] = useState<File | null>(null);
  const [airingPreference, setAiringPreference] =
    useState<"one_off" | "permanent">("one_off");
  const [vouched, setVouched] = useState(false);
  const [state, setState] = useState<State>({ kind: "input" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [audioDrag, setAudioDrag] = useState(false);
  const [artworkDrag, setArtworkDrag] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const artworkInputRef = useRef<HTMLInputElement>(null);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 80) {
      errs.name = "Between 2 and 80 characters.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = "Enter a valid email address.";
    }
    if (!audio) {
      errs.audio = "Pick an MP3 file.";
    } else if (audio.size > MAX_AUDIO_MB * 1024 * 1024) {
      errs.audio = `MP3 must be ${MAX_AUDIO_MB} MB or smaller.`;
    }
    if (artwork && artwork.size > MAX_ART_MB * 1024 * 1024) {
      errs.artwork = `Artwork must be ${MAX_ART_MB} MB or smaller.`;
    }
    if (!vouched) {
      errs.vouched = "Tick the confirmation box to submit.";
    }
    return errs;
  }

  const errs = validate();
  const canSubmit = Object.keys(errs).length === 0 && state.kind === "input";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    setFieldErrors(v);
    if (Object.keys(v).length > 0) return;
    if (!audio) return; // validate() already guards but TS needs the narrowing
    setState({ kind: "submitting" });

    const artKind: "png" | "jpeg" | null =
      artwork
        ? artwork.type === "image/png"
          ? "png"
          : "jpeg"
        : null;

    try {
      // Step 1 — init: server validates metadata + reserves a row, returns presigned URLs
      const initRes = await fetch("/api/submissions/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          vouched: true,
          airingPreference,
          audioSize: audio.size,
          artworkKind: artKind,
          artworkSize: artwork?.size ?? null,
        }),
      });
      const initJson = (await initRes.json().catch(() => ({}))) as {
        ok?: boolean; id?: string; audioPutUrl?: string; audioContentType?: string;
        artworkPutUrl?: string | null; artworkContentType?: string | null;
        error?: string; message?: string;
      };
      if (!initRes.ok || !initJson.id || !initJson.audioPutUrl) {
        setState({
          kind: "error",
          message: initJson.message ?? `Could not start upload (HTTP ${initRes.status}).`,
        });
        return;
      }

      // Step 2 — direct PUT to B2 (bypasses Vercel's 4.5 MB body cap)
      const audioPut = await fetch(initJson.audioPutUrl, {
        method: "PUT",
        headers: { "content-type": initJson.audioContentType ?? "audio/mpeg" },
        body: audio,
      });
      if (!audioPut.ok) {
        setState({
          kind: "error",
          message: `Audio upload failed (HTTP ${audioPut.status}). Please try again.`,
        });
        return;
      }

      if (artwork && initJson.artworkPutUrl) {
        const artPut = await fetch(initJson.artworkPutUrl, {
          method: "PUT",
          headers: { "content-type": initJson.artworkContentType ?? "image/jpeg" },
          body: artwork,
        });
        if (!artPut.ok) {
          setState({
            kind: "error",
            message: `Artwork upload failed (HTTP ${artPut.status}). Please try again.`,
          });
          return;
        }
      }

      // Step 3 — finalize: server fetches files, magic-byte validates, flips to pending
      const finRes = await fetch("/api/submissions/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: initJson.id, hasArtwork: !!artwork }),
      });
      const finJson = (await finRes.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; message?: string;
      };
      if (!finRes.ok) {
        setState({
          kind: "error",
          message: finJson.message ?? `Submission failed at finalize (HTTP ${finRes.status}).`,
        });
        return;
      }
      setState({ kind: "ok", email: email.trim(), receivedAt: new Date() });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function pickedAudio(f: File | null) {
    setAudio(f);
    if (!f && audioInputRef.current) audioInputRef.current.value = "";
  }
  function pickedArtwork(f: File | null) {
    setArtwork(f);
    if (!f && artworkInputRef.current) artworkInputRef.current.value = "";
  }

  // ── Confirmation state ───────────────────────────────────
  if (state.kind === "ok") {
    return (
      <div className="confirm-card" role="status" aria-live="polite">
        <div className="confirm-stamp">
          <span className="pulse" />
          Received · {fmtStamp(state.receivedAt)}
        </div>
        <h2>Got it.</h2>
        <p className="lead">
          Lena will listen and you&apos;ll hear back at{" "}
          <strong style={{ color: "var(--fg)" }}>{state.email}</strong>.
        </p>
        <p className="meta">
          One submission per email at a time · Want to withdraw later?{" "}
          <a href="mailto:hello@numaradio.com">email hello@numaradio.com</a>
        </p>
      </div>
    );
  }

  return (
    <form className="submit-form-shell" onSubmit={onSubmit} noValidate>
      {/* 01 — Your name */}
      <div className="submit-field submit-field--first">
        <div className="submit-field-label">
          <span className="num">01</span>
          <span className="name">Your name</span>
        </div>
        <input
          type="text"
          className={`submit-input ${fieldErrors.name ? "is-error" : ""}`}
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="As we should credit you on air"
          autoComplete="name"
        />
        {fieldErrors.name && <span className="submit-error">{fieldErrors.name}</span>}
      </div>

      {/* 02 — Email */}
      <div className="submit-field">
        <div className="submit-field-label">
          <span className="num">02</span>
          <span className="name">Email</span>
        </div>
        <input
          type="email"
          className={`submit-input ${fieldErrors.email ? "is-error" : ""}`}
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          placeholder="Where we'll write back yes / no"
          autoComplete="email"
        />
        {fieldErrors.email && <span className="submit-error">{fieldErrors.email}</span>}
      </div>

      {/* 03 — Track file */}
      <div className="submit-field">
        <div className="submit-field-label">
          <span className="num">03</span>
          <span className="name">Track file</span>
          <span className="hint">MP3 · max {MAX_AUDIO_MB} MB</span>
        </div>
        <label
          className={`submit-dropzone ${audio ? "has-file" : ""} ${audioDrag ? "is-active" : ""}`}
          onDragOver={(e: DragEvent<HTMLLabelElement>) => {
            e.preventDefault();
            setAudioDrag(true);
          }}
          onDragLeave={() => setAudioDrag(false)}
          onDrop={(e: DragEvent<HTMLLabelElement>) => {
            e.preventDefault();
            setAudioDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) pickedAudio(f);
          }}
        >
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={(e) => pickedAudio(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />
          {audio ? (
            <div className="submit-file-chip">
              <div className="icon">MP3</div>
              <div className="meta">
                <span className="name">{audio.name}</span>
                <span className="size">{fmtBytes(audio.size)}</span>
              </div>
              <button
                type="button"
                className="remove"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pickedAudio(null);
                }}
                aria-label="Remove file"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="submit-dropzone-prompt">
              <span className="lead">Drop your MP3 here, or click to choose</span>
              <span className="sub">
                {audioDrag ? "Release to attach" : `Up to ${MAX_AUDIO_MB} MB`}
              </span>
            </div>
          )}
        </label>
        {fieldErrors.audio && <span className="submit-error">{fieldErrors.audio}</span>}
      </div>

      {/* 04 — Cover (optional) */}
      <div className="submit-field">
        <div className="submit-field-label">
          <span className="num">04</span>
          <span className="name">Cover</span>
          <span className="hint">Optional · PNG or JPEG · max {MAX_ART_MB} MB</span>
        </div>
        <label
          className={`submit-dropzone ${artwork ? "has-file" : ""} ${artworkDrag ? "is-active" : ""}`}
          onDragOver={(e: DragEvent<HTMLLabelElement>) => {
            e.preventDefault();
            setArtworkDrag(true);
          }}
          onDragLeave={() => setArtworkDrag(false)}
          onDrop={(e: DragEvent<HTMLLabelElement>) => {
            e.preventDefault();
            setArtworkDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) pickedArtwork(f);
          }}
        >
          <input
            ref={artworkInputRef}
            type="file"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            onChange={(e) => pickedArtwork(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />
          {artwork ? (
            <div className="submit-file-chip">
              <div className="icon">{/\.png$/i.test(artwork.name) ? "PNG" : "JPG"}</div>
              <div className="meta">
                <span className="name">{artwork.name}</span>
                <span className="size">{fmtBytes(artwork.size)}</span>
              </div>
              <button
                type="button"
                className="remove"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pickedArtwork(null);
                }}
                aria-label="Remove file"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="submit-dropzone-prompt">
              <span className="lead">Drop a cover here, or skip</span>
              <span className="sub">
                {artworkDrag
                  ? "Release to attach"
                  : "We'll use embedded art or generate one"}
              </span>
            </div>
          )}
        </label>
        {fieldErrors.artwork && (
          <span className="submit-error">{fieldErrors.artwork}</span>
        )}
      </div>

      {/* 05 — Airing preference */}
      <div className="submit-field">
        <div className="submit-field-label">
          <span className="num">05</span>
          <span className="name">How should we air it?</span>
        </div>
        <div className="submit-airing-grid" role="radiogroup" aria-label="Airing preference">
          <button
            type="button"
            role="radio"
            aria-checked={airingPreference === "one_off"}
            className={`submit-airing-card ${airingPreference === "one_off" ? "is-selected" : ""}`}
            onClick={() => setAiringPreference("one_off")}
          >
            <span className="label">One-off airing</span>
            <span className="desc">
              We air this once. After that it&apos;s not in rotation.
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={airingPreference === "permanent"}
            className={`submit-airing-card ${airingPreference === "permanent" ? "is-selected" : ""}`}
            onClick={() => setAiringPreference("permanent")}
          >
            <span className="label">Permanent rotation</span>
            <span className="desc">
              We add this to our regular library. Plays on rotation indefinitely.
            </span>
          </button>
        </div>
      </div>

      {/* 06 — Sign off */}
      <div className="submit-field">
        <div className="submit-field-label">
          <span className="num">06</span>
          <span className="name">Sign off</span>
        </div>
        <label className={`submit-vouch ${fieldErrors.vouched ? "is-error" : ""}`}>
          <input
            type="checkbox"
            checked={vouched}
            onChange={(e) => setVouched(e.target.checked)}
          />
          <span className="submit-vouch-text">
            I confirm this is my own work or I have all rights to it, and I&apos;m
            authorising Numa Radio to broadcast it. I understand I can withdraw it any
            time by emailing{" "}
            <a href="mailto:hello@numaradio.com">hello@numaradio.com</a>. I&apos;ve read
            the <a href="/privacy#submissions">terms</a>.
          </span>
        </label>
        {fieldErrors.vouched && (
          <span className="submit-error">{fieldErrors.vouched}</span>
        )}
      </div>

      {/* Server error */}
      {state.kind === "error" && (
        <div className="submit-server-error" role="alert">
          <span style={{ fontWeight: 700 }}>✗</span>
          <span>{state.message}</span>
        </div>
      )}

      {/* Submit row */}
      <div className="submit-row">
        <span className={`submit-meta ${canSubmit ? "is-ready" : ""}`}>
          {state.kind === "submitting"
            ? "Uploading…"
            : canSubmit
            ? "Ready to send"
            : "Fill the fields above"}
        </span>
        <button type="submit" className="submit-btn" disabled={!canSubmit}>
          {state.kind === "submitting" ? (
            <>
              <span>Sending</span>
              <span className="dots">
                <span />
                <span />
                <span />
              </span>
            </>
          ) : (
            <>
              <span>Send to Lena</span>
              <span className="arrow">→</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
