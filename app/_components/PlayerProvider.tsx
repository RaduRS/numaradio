"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const STREAM_URL = "https://api.numaradio.com/stream";

export type PlayerStatus = "idle" | "loading" | "playing" | "error";

type PlayerState = {
  status: PlayerStatus;
  isPlaying: boolean;
  isLoading: boolean;
  toggle: () => void;
  play: () => void;
  pause: () => void;
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
  };

  return (
    <PlayerContext.Provider value={value}>
      {/* Single shared audio element — never unmounted. */}
      <audio ref={audioRef} preload="none" />
      {children}
    </PlayerContext.Provider>
  );
}
