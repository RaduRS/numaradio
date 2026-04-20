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

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setStatus("loading");
    // Reload the stream on every play so we never resume from a stale buffer.
    audio.src = STREAM_URL;
    audio.load();
    try {
      await audio.play();
      // Browser will fire `playing` once buffered — we update status there.
    } catch {
      // Autoplay/permission blocked — back to idle so user can retry.
      setStatus("idle");
    }
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setStatus("idle");
  }, []);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "loading") pause();
    else play();
  }, [status, play, pause]);

  // Mirror native audio events into our state machine.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlaying = () => setStatus("playing");
    const onWaiting = () => {
      // `waiting` fires for both initial buffer-up and rebuffers; only show
      // loading if we aren't already playing successfully.
      setStatus((prev) => (prev === "playing" ? "playing" : "loading"));
    };
    const onPause = () => {
      // Only treat as idle if the source is actually unloaded — otherwise
      // it's a transient browser pause we shouldn't reflect in the UI.
      if (!audio.src) setStatus("idle");
    };
    const onError = () => setStatus("error");

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
  }, []);

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
