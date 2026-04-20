"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ThumbsUpIcon, ThumbsDownIcon } from "./Icons";
import { getSessionId } from "./session-id";

type Vote = 1 | -1;

type VoteState = {
  up: number;
  down: number;
  mine: Vote | null;
};

type Props = {
  trackId: string | undefined;
};

export function VoteButtons({ trackId }: Props) {
  const [state, setState] = useState<VoteState>({ up: 0, down: 0, mine: null });
  const [pending, setPending] = useState<Vote | null>(null);
  const trackIdRef = useRef<string | undefined>(trackId);
  trackIdRef.current = trackId;

  // Fetch current counts + this session's existing vote on mount /
  // whenever the track changes. The fetch is a cheap Neon count pair.
  useEffect(() => {
    if (!trackId) {
      setState({ up: 0, down: 0, mine: null });
      return;
    }
    const ctrl = new AbortController();
    const sessionId = getSessionId();
    const url = `/api/vote?trackId=${encodeURIComponent(trackId)}&sessionId=${encodeURIComponent(sessionId)}`;
    fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: VoteState | null) => {
        // Guard against late responses from a previous track.
        if (data && trackIdRef.current === trackId) setState(data);
      })
      .catch(() => {
        /* ignore */
      });
    return () => ctrl.abort();
  }, [trackId]);

  const submit = useCallback(
    async (value: Vote) => {
      if (!trackId || pending) return;
      setPending(value);
      // Optimistic: bump the count, flip mine. The server response
      // corrects it if we guessed wrong.
      setState((prev) => optimistic(prev, value));
      try {
        const r = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trackId,
            sessionId: getSessionId(),
            value,
          }),
        });
        if (r.ok) {
          const data = (await r.json()) as VoteState;
          if (trackIdRef.current === trackId) setState(data);
        }
      } catch {
        /* network blip — optimistic UI stays; next track fetch repairs */
      } finally {
        setPending(null);
      }
    },
    [trackId, pending],
  );

  const disabled = !trackId;

  return (
    <div className="vote-row" role="group" aria-label="Rate this track">
      <button
        type="button"
        className={`vote-btn up ${state.mine === 1 ? "active" : ""}`}
        onClick={() => submit(1)}
        disabled={disabled}
        aria-pressed={state.mine === 1}
        aria-label="Thumbs up"
      >
        <ThumbsUpIcon className="vote-icon" />
        <span className="vote-count">{state.up}</span>
      </button>
      <button
        type="button"
        className={`vote-btn down ${state.mine === -1 ? "active" : ""}`}
        onClick={() => submit(-1)}
        disabled={disabled}
        aria-pressed={state.mine === -1}
        aria-label="Thumbs down"
      >
        <ThumbsDownIcon className="vote-icon" />
        <span className="vote-count">{state.down}</span>
      </button>
    </div>
  );
}

function optimistic(prev: VoteState, value: Vote): VoteState {
  if (prev.mine === value) return prev;
  let { up, down } = prev;
  if (prev.mine === 1) up = Math.max(0, up - 1);
  if (prev.mine === -1) down = Math.max(0, down - 1);
  if (value === 1) up += 1;
  else down += 1;
  return { up, down, mine: value };
}
