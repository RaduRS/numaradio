"use client";

import { useEffect, useState } from "react";
import { LoadingIcon, SendIcon } from "./Icons";
import {
  clearSongStash,
  isFresh,
  readSongStash,
  SONG_STASH_MAX_AGE_MS,
  writeSongStash,
} from "@/lib/booth-stash";

// Quiet-confidence rotator shown while Lena's working on the track. No
// stage-specific machine-words ("Composing… / Painting the cover…") — just
// reassurance that a person has it in hand.
const PENDING_LINES: readonly string[] = [
  "In the studio — your song's coming up.",
  "Lena's giving it a listen.",
  "Almost ready for air.",
];
const PENDING_LINE_MS = 4_500;

interface QueueStats {
  queueDepth: number;
  inProgress: boolean;
  estWaitSeconds: number;
}

interface SubmitResponse {
  ok: boolean;
  requestId?: string;
  queuePosition?: number;
  estWaitSeconds?: number;
  finalArtistName?: string;
  artistNameSubstituted?: boolean;
  error?: string;
  detail?: string;
  retryAfterSeconds?: number;
  max?: number;
}

interface StatusResponse {
  ok: boolean;
  status?: string;
  errorMessage?: string;
  finalArtistName?: string;
  artistNameSubstituted?: boolean;
  title?: string;
  audioUrl?: string;
  artworkUrl?: string;
  trackId?: string | null;
  durationSeconds?: number | null;
  isInstrumental?: boolean;
  lyricsFallback?: boolean;
  queuePosition?: number;
  estWaitSeconds?: number;
}

const PROMPT_MIN = 4;
const PROMPT_MAX = 240;
const ARTIST_MIN = 2;
const ARTIST_MAX = 40;

function fmtWait(secs: number | undefined): string {
  if (!secs || secs <= 0) return "< 1 min";
  return `${Math.ceil(secs / 60)} min`;
}

function fmtDuration(secs: number | null | undefined): string | null {
  if (!secs || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SongTab() {
  const [artistName, setArtistName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ requestId: string } | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [pendingLineIdx, setPendingLineIdx] = useState(0);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [artistError, setArtistError] = useState<string | null>(null);

  // Hydrate pending state from localStorage on mount so a tab-switch or
  // page reload during the ~3 min wait doesn't wipe the "Lena's working
  // on it" card and tempt the user to submit a duplicate. setState in an
  // effect is the idiomatic pattern here — localStorage can't be read on
  // the server, so a useState initializer would cause hydration mismatch.
  useEffect(() => {
    const stash = readSongStash();
    if (!stash) return;
    if (!isFresh(stash.submittedAt, SONG_STASH_MAX_AGE_MS)) {
      clearSongStash();
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration from browser-only storage
    setPending({ requestId: stash.requestId });
  }, []);

  useEffect(() => {
    if (pending) return;
    const tick = async (): Promise<void> => {
      // Skip while tab is hidden — visibility listener re-fires on focus.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/booth/song/queue-stats");
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean } & QueueStats;
        if (data.ok) setQueueStats(data);
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pending]);

  // Rotate the pending message every ~4.5s while Lena's working.
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(
      () => setPendingLineIdx((i) => (i + 1) % PENDING_LINES.length),
      PENDING_LINE_MS,
    );
    return () => clearInterval(id);
  }, [pending]);

  // Clear localStorage stash once we hit a terminal state, so the next
  // visit shows a fresh form.
  useEffect(() => {
    if (!status) return;
    if (status.status === "done" || status.status === "failed") {
      clearSongStash();
    }
  }, [status]);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      // Skip while tab is hidden — visibility listener re-fires on focus.
      // The status row is append-only on the server, so resuming with a
      // single immediate poll catches up cleanly.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/booth/song/${pending.requestId}/status`);
        if (res.status === 404) {
          // Server forgot this row (failure cleanup, or very stale stash).
          // Unstick the UI instead of leaving the rotator running forever.
          if (cancelled) return;
          clearSongStash();
          setPending(null);
          setStatus(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as StatusResponse;
        if (!cancelled && data.ok) setStatus(data);
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, 5_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pending]);

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitError(null);

    const trimmedPrompt = prompt.trim();
    const trimmedArtist = artistName.trim();
    const formEl = e.currentTarget;

    let firstInvalid: HTMLElement | null = null;
    if (trimmedPrompt.length < PROMPT_MIN) {
      setPromptError(
        trimmedPrompt.length === 0
          ? "Describe the song so Lena knows what to make."
          : `A little longer — at least ${PROMPT_MIN} characters.`,
      );
      firstInvalid =
        firstInvalid ??
        formEl.querySelector<HTMLTextAreaElement>('textarea[name="song-prompt"]');
    } else {
      setPromptError(null);
    }
    if (trimmedArtist.length < ARTIST_MIN) {
      setArtistError(
        trimmedArtist.length === 0
          ? "Add an artist name so Lena can credit you on air."
          : `A little longer — at least ${ARTIST_MIN} characters.`,
      );
      firstInvalid =
        firstInvalid ??
        formEl.querySelector<HTMLInputElement>('input[name="song-artist"]');
    } else {
      setArtistError(null);
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/booth/song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          artistName: artistName.trim(),
          isInstrumental,
        }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (!res.ok || !data.ok) {
        const wait = data.retryAfterSeconds
          ? ` — retry in ${fmtWait(data.retryAfterSeconds)}`
          : "";
        const detail = data.detail ? `: ${data.detail}` : "";
        setSubmitError(
          data.error ? `${data.error}${detail}${wait}` : "Something went wrong.",
        );
        return;
      }
      setPending({ requestId: data.requestId! });
      writeSongStash(data.requestId!);
      setPendingLineIdx(0);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (status && status.status === "done" && status.trackId) {
    return (
      <div className="req-input-group">
        {status.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={status.artworkUrl}
            alt={status.title ?? "cover"}
            style={{
              width: "100%",
              maxWidth: 280,
              aspectRatio: "1 / 1",
              objectFit: "cover",
              borderRadius: 12,
              border: "1px solid var(--line)",
            }}
          />
        ) : null}
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>
            {status.title ?? "Your song"}
          </div>
          <div style={{ color: "var(--fg-mute)", fontSize: 13, marginTop: 2 }}>
            by {status.finalArtistName}
            {fmtDuration(status.durationSeconds) ? ` · ${fmtDuration(status.durationSeconds)}` : ""}
          </div>
          {status.artistNameSubstituted ? (
            <div style={{ color: "var(--fg-mute)", fontSize: 12, marginTop: 6 }}>
              (we swapped in &ldquo;Numa Radio&rdquo; — your artist name
              couldn&rsquo;t be aired)
            </div>
          ) : null}
          {status.lyricsFallback ? (
            <div style={{ color: "var(--fg-mute)", fontSize: 12, marginTop: 6 }}>
              (our lyric writer tripped the moderator, so we aired it
              instrumental — try a different vibe for vocals)
            </div>
          ) : null}
        </div>
        <p style={{ fontSize: 13 }}>On air now — listen.</p>
      </div>
    );
  }

  if (status && status.status === "failed") {
    return (
      <div className="req-input-group">
        <p style={{ fontSize: 14 }}>
          We couldn&rsquo;t air your song: {status.errorMessage ?? "unknown"}.
        </p>
        <p style={{ fontSize: 13, color: "var(--fg-mute)" }}>
          Your slot has been refunded — try again in a minute.
        </p>
        <button
          type="button"
          className="btn btn-primary req-send"
          onClick={() => {
            clearSongStash();
            setPending(null);
            setStatus(null);
            setSubmitError(null);
          }}
        >
          <span>Try again</span>
          <SendIcon className="btn-icon" />
        </button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="req-pending">
        <div className="rp-head">
          <span className="rp-dot" aria-hidden />
          <span className="rp-kicker">In the booth</span>
        </div>
        <div className="rp-rotator">
          {PENDING_LINES.map((line, i) => (
            <div
              key={i}
              className={`rp-line ${i === pendingLineIdx ? "active" : ""}`}
            >
              {line}
            </div>
          ))}
        </div>
        {status?.finalArtistName ? (
          <div className="rp-credit">by {status.finalArtistName}</div>
        ) : null}
      </div>
    );
  }

  const aheadCount =
    queueStats ? queueStats.queueDepth + (queueStats.inProgress ? 1 : 0) : null;

  return (
    <form onSubmit={submit} noValidate>
      <div className="req-input-group">
        <textarea
          name="song-prompt"
          className={`req-input req-textarea${promptError ? " invalid" : ""}`}
          placeholder="Describe the song — mood, genre, tempo / BPM, key, vibe"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (promptError) setPromptError(null);
          }}
          maxLength={PROMPT_MAX}
          rows={3}
          required
          aria-invalid={promptError ? "true" : undefined}
          aria-describedby={promptError ? "song-prompt-error" : undefined}
        />
        {promptError ? (
          <div
            id="song-prompt-error"
            className="req-field-error"
            role="alert"
          >
            {promptError}
          </div>
        ) : null}
        <input
          name="song-artist"
          className={`req-input${artistError ? " invalid" : ""}`}
          placeholder="Your artist name (shown as credit)"
          value={artistName}
          onChange={(e) => {
            setArtistName(e.target.value);
            if (artistError) setArtistError(null);
          }}
          maxLength={ARTIST_MAX}
          required
          aria-invalid={artistError ? "true" : undefined}
          aria-describedby={artistError ? "song-artist-error" : undefined}
        />
        {artistError ? (
          <div
            id="song-artist-error"
            className="req-field-error"
            role="alert"
          >
            {artistError}
          </div>
        ) : null}
        <label className="req-check">
          <input
            type="checkbox"
            checked={isInstrumental}
            onChange={(e) => setIsInstrumental(e.target.checked)}
          />
          <span className="req-check-box" aria-hidden />
          <span className="req-check-label">Instrumental only</span>
        </label>
      </div>
      <button
        type="submit"
        className="btn btn-primary req-send"
        disabled={submitting}
        aria-busy={submitting}
      >
        <span>{submitting ? "Submitting…" : "Create song"}</span>
        {submitting ? <LoadingIcon className="btn-icon" /> : <SendIcon className="btn-icon" />}
      </button>
      {submitError ? (
        <div
          role="status"
          style={{ marginTop: 12, fontSize: 13, color: "#e85a4f" }}
        >
          {submitError}
        </div>
      ) : null}
      {aheadCount !== null ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--fg-mute)",
            fontFamily: "var(--font-mono)",
          }}
        >
          ~3 min · {aheadCount} request{aheadCount === 1 ? "" : "s"} ahead of you
        </div>
      ) : null}
    </form>
  );
}
