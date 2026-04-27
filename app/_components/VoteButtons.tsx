"use client";

import { useCallback, useEffect, useState } from "react";
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

const EMPTY: VoteState = { up: 0, down: 0, mine: null };

// ─── Module-level singleton store keyed by trackId ──────────────
//
// Multiple VoteButtons instances render the same now-playing artwork
// across the page (PlayerCard, Broadcast section 04, ExpandedPlayer
// mobile + desktop). Without a shared store, each instance keeps its
// own local count; clicking thumbs-up on one only updated that one,
// the others stayed stale until the next page poll. The store fixes
// that — any successful publish broadcasts to every subscriber for
// that trackId so all instances flip together instantly.

const stateCache = new Map<string, VoteState>();
const subscribers = new Map<string, Set<(s: VoteState) => void>>();
const pendingFetches = new Map<string, Promise<void>>();

function publish(trackId: string, next: VoteState): void {
  stateCache.set(trackId, next);
  subscribers.get(trackId)?.forEach((sub) => sub(next));
}

function ensureFetched(trackId: string): void {
  if (stateCache.has(trackId)) return;
  if (pendingFetches.has(trackId)) return;
  const sessionId = getSessionId();
  const url = `/api/vote?trackId=${encodeURIComponent(trackId)}&sessionId=${encodeURIComponent(sessionId)}`;
  const p = fetch(url, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: VoteState | null) => {
      if (data) publish(trackId, data);
    })
    .catch(() => {
      /* ignore — UI stays at EMPTY until next fetch */
    })
    .finally(() => {
      pendingFetches.delete(trackId);
    });
  pendingFetches.set(trackId, p);
}

function subscribe(trackId: string, fn: (s: VoteState) => void): () => void {
  let set = subscribers.get(trackId);
  if (!set) {
    set = new Set();
    subscribers.set(trackId, set);
  }
  set.add(fn);
  const cached = stateCache.get(trackId);
  if (cached) fn(cached);
  ensureFetched(trackId);
  return () => {
    subscribers.get(trackId)?.delete(fn);
  };
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

async function submitVote(trackId: string, value: Vote): Promise<void> {
  // Optimistic publish — every subscriber updates instantly. Server
  // response corrects it on return (or we keep the optimistic state
  // on a transient network failure; the next track-change refetch
  // repairs).
  const prev = stateCache.get(trackId) ?? EMPTY;
  publish(trackId, optimistic(prev, value));
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
      publish(trackId, data);
    }
  } catch {
    /* keep optimistic */
  }
}

// ─── React hook glue ─────────────────────────────────────────────

export function VoteButtons({ trackId }: Props) {
  const [state, setState] = useState<VoteState>(
    () => (trackId && stateCache.get(trackId)) || EMPTY,
  );
  const [pending, setPending] = useState<Vote | null>(null);

  useEffect(() => {
    if (!trackId) {
      setState(EMPTY);
      return;
    }
    return subscribe(trackId, setState);
  }, [trackId]);

  const submit = useCallback(
    async (value: Vote) => {
      if (!trackId || pending) return;
      setPending(value);
      try {
        await submitVote(trackId, value);
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
