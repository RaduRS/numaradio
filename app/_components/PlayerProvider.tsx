"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNowPlaying } from "./useNowPlaying";

const STREAM_URL = "https://api.numaradio.com/stream";
const VOLUME_STORAGE_KEY = "numa.volume";
const MUTED_STORAGE_KEY = "numa.muted";
const DEFAULT_VOLUME = 0.8;
// Exponential backoff for auto-reconnect after stream drops (server
// restart, tunnel flap, etc.). Caps at 30s so the player keeps trying
// forever but doesn't hammer the origin.
const RECONNECT_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

export type PlayerStatus = "idle" | "loading" | "playing" | "error";

type PlayerState = {
  status: PlayerStatus;
  isPlaying: boolean;
  isLoading: boolean;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  volume: number;
  isMuted: boolean;
  setVolume: (v: number) => void;
  toggleMute: () => void;
};

const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [volume, setVolumeState] = useState<number>(DEFAULT_VOLUME);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  // User intent: "I want the stream playing". Stays true across error/retry
  // cycles so the player keeps trying to reconnect; only flipped off by an
  // explicit pause() call.
  const wantPlaybackRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const playRef = useRef<() => void>(() => {});

  // Hydrate volume + mute from localStorage after mount (avoids SSR/CSR
  // hydration mismatch).
  useEffect(() => {
    try {
      const vRaw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
      if (vRaw !== null) {
        const v = parseFloat(vRaw);
        if (Number.isFinite(v)) setVolumeState(Math.max(0, Math.min(1, v)));
      }
      const mRaw = window.localStorage.getItem(MUTED_STORAGE_KEY);
      if (mRaw === "true") setIsMuted(true);
    } catch {
      /* localStorage unavailable (private mode, SSR) — keep defaults */
    }
  }, []);

  // Apply volume/mute to the real audio element whenever they change.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
    audio.muted = isMuted;
  }, [volume, isMuted]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
    // Dragging the slider above 0 implicitly unmutes.
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
      try {
        window.localStorage.setItem(MUTED_STORAGE_KEY, "false");
      } catch {
        /* ignore */
      }
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(MUTED_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (!wantPlaybackRef.current) return;
    if (retryTimeoutRef.current) return;
    const idx = Math.min(retryAttemptRef.current, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[idx];
    retryAttemptRef.current += 1;
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      if (wantPlaybackRef.current) playRef.current();
    }, delay);
  }, []);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    wantPlaybackRef.current = true;
    clearRetry();
    setStatus("loading");
    // Reload the stream on every play so we never resume from a stale buffer.
    audio.src = STREAM_URL;
    audio.load();
    try {
      await audio.play();
      // Browser will fire `playing` once buffered — we update status there.
    } catch (err) {
      // NotAllowedError = autoplay/gesture policy blocked us. User has to
      // click again — bail without retry loop.
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        wantPlaybackRef.current = false;
        retryAttemptRef.current = 0;
        setStatus("idle");
        return;
      }
      // Anything else is transient (network down on initial attempt etc.)
      // — keep user intent and retry with backoff.
      scheduleRetry();
    }
  }, [clearRetry, scheduleRetry]);

  // Keep a ref to the latest `play` so scheduleRetry's setTimeout callback
  // always calls the current closure without needing play in its deps.
  useEffect(() => {
    playRef.current = play;
  }, [play]);

  const pause = useCallback(() => {
    wantPlaybackRef.current = false;
    retryAttemptRef.current = 0;
    clearRetry();
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setStatus("idle");
  }, [clearRetry]);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "loading") pause();
    else play();
  }, [status, play, pause]);

  // Mirror native audio events into our state machine.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Any event that means "stream isn't coming in" falls through to here.
    // In real outages browsers diverge: Chrome often fires `error`, Safari
    // may just fire `pause` or `stalled`, some fire `ended` when the origin
    // closes the HTTP connection mid-MP3. We treat them all the same — if
    // the user still wants playback, keep retrying with backoff.
    const handleInterruption = (reason: string) => {
      if (!wantPlaybackRef.current) return;
      // Kill the dead source so the next retry opens a fresh connection
      // instead of the browser "resuming" from stale state.
      if (audio.src) {
        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch {
          /* ignore — best-effort cleanup */
        }
      }
      setStatus("loading");
      scheduleRetry();
      // eslint-disable-next-line no-console -- useful breadcrumb for users reporting outage recovery
      console.debug("[player] interrupted:", reason, "— scheduling reconnect");
    };

    const onPlaying = () => {
      setStatus("playing");
      // Successful playback — reset the backoff and cancel any pending
      // retry so the *next* outage starts retrying fast again.
      retryAttemptRef.current = 0;
      clearRetry();
    };
    const onWaiting = () => {
      // `waiting` fires for both initial buffer-up and rebuffers; only show
      // loading if we aren't already playing successfully. The watchdog
      // effect below escalates to a full reconnect if we're stuck.
      setStatus((prev) => (prev === "playing" ? "playing" : "loading"));
    };
    const onPause = () => {
      if (!audio.src) {
        setStatus("idle");
        return;
      }
      // src still set but audio paused — not user-initiated (our pause()
      // clears src first). Browser auto-paused us, almost always because
      // the upstream connection dropped. Retry.
      handleInterruption("pause-with-src");
    };
    const onError = () => handleInterruption("error");
    const onStalled = () => handleInterruption("stalled");
    const onEnded = () => handleInterruption("ended");

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("ended", onEnded);
    };
  }, [scheduleRetry, clearRetry]);

  // Watchdog: while stuck in "loading", force a fresh reconnect every 12s.
  // Safety net for browsers that go silent without firing any recovery
  // event (Safari especially) — saw this in live testing where the UI
  // showed zero audio with no error event for minutes. Event-driven
  // scheduleRetry is the primary recovery; this is the backstop.
  useEffect(() => {
    if (status !== "loading") return;
    const interval = setInterval(() => {
      if (wantPlaybackRef.current) playRef.current();
    }, 12_000);
    return () => clearInterval(interval);
  }, [status]);

  // Clean up any pending retry timer on unmount.
  useEffect(() => {
    return () => clearRetry();
  }, [clearRetry]);

  const value: PlayerState = {
    status,
    isPlaying: status === "playing",
    isLoading: status === "loading",
    toggle,
    play,
    pause,
    volume,
    isMuted,
    setVolume,
    toggleMute,
  };

  return (
    <PlayerContext.Provider value={value}>
      {/* Single shared audio element — never unmounted. */}
      <audio ref={audioRef} preload="none" />
      <MediaSessionSync />
      {children}
    </PlayerContext.Provider>
  );
}

// Mirrors now-playing + player state into the Media Session API so that
// iOS Control Center / Android notifications / lock-screen show track
// metadata and can drive play/pause remotely.
function MediaSessionSync() {
  const { isPlaying, play, pause } = usePlayer();
  const np = useNowPlaying();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    if (!np.title) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: np.title,
      artist: np.artistDisplay ?? "",
      album: "Numa Radio",
      artwork: np.artworkUrl
        ? [
            {
              src: np.artworkUrl,
              sizes: "512x512",
              type: "image/jpeg",
            },
          ]
        : [],
    });
  }, [np.title, np.artistDisplay, np.artworkUrl]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    navigator.mediaSession.setActionHandler("play", () => play());
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("stop", () => pause());
    // This is live radio — nothing to seek to.
    navigator.mediaSession.setActionHandler("seekto", null);
    navigator.mediaSession.setActionHandler("seekbackward", null);
    navigator.mediaSession.setActionHandler("seekforward", null);
    navigator.mediaSession.setActionHandler("previoustrack", null);
    navigator.mediaSession.setActionHandler("nexttrack", null);
  }, [play, pause]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  return null;
}
