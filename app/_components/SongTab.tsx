"use client";

import { useEffect, useState } from "react";
import { LoadingIcon, SendIcon } from "./Icons";

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

export function SongTab() {
  const [artistName, setArtistName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ requestId: string } | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);

  useEffect(() => {
    if (pending) return;
    const tick = async (): Promise<void> => {
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
    return () => clearInterval(id);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/booth/song/${pending.requestId}/status`);
        if (!res.ok) return;
        const data = (await res.json()) as StatusResponse;
        if (!cancelled && data.ok) setStatus(data);
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pending]);

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
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
        <p style={{ fontSize: 13 }}>Airing on the stream now — tune in.</p>
      </div>
    );
  }

  if (status && status.status === "failed") {
    return (
      <div className="req-input-group">
        <p style={{ fontSize: 14 }}>
          We couldn&rsquo;t generate your song: {status.errorMessage ?? "unknown"}.
        </p>
        <p style={{ fontSize: 13, color: "var(--fg-mute)" }}>
          Your slot has been refunded — try again in a minute.
        </p>
        <button
          type="button"
          className="btn btn-primary req-send"
          onClick={() => {
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
    const captions: Record<string, string> = {
      queued: "queued",
      processing: "composing",
      finalizing: "painting the cover",
    };
    const caption = status?.status ? captions[status.status] ?? status.status : "queued";
    return (
      <div className="req-input-group">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>
          Generating…
        </div>
        <div style={{ color: "var(--fg-mute)", fontSize: 13 }}>{caption}</div>
        {status?.queuePosition && status.queuePosition > 0 ? (
          <div style={{ color: "var(--fg-mute)", fontSize: 13 }}>
            {status.queuePosition} ahead of you · est. {fmtWait(status.estWaitSeconds)}
          </div>
        ) : null}
      </div>
    );
  }

  const submitDisabled =
    submitting ||
    prompt.trim().length < PROMPT_MIN ||
    artistName.trim().length < ARTIST_MIN;

  const aheadCount =
    queueStats ? queueStats.queueDepth + (queueStats.inProgress ? 1 : 0) : null;

  return (
    <form onSubmit={submit}>
      <div className="req-input-group">
        <textarea
          className="req-input req-textarea"
          placeholder="Describe the song — mood, genre, tempo / BPM, key, vibe"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={PROMPT_MAX}
          minLength={PROMPT_MIN}
          rows={3}
          required
        />
        <input
          className="req-input"
          placeholder="Your artist name (shown as credit)"
          value={artistName}
          onChange={(e) => setArtistName(e.target.value)}
          maxLength={ARTIST_MAX}
          minLength={ARTIST_MIN}
          required
        />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--fg-dim)",
          }}
        >
          <input
            type="checkbox"
            checked={isInstrumental}
            onChange={(e) => setIsInstrumental(e.target.checked)}
          />
          Instrumental only
        </label>
      </div>
      <button
        type="submit"
        className="btn btn-primary req-send"
        disabled={submitDisabled}
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
