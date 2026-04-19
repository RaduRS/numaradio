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

type PlayerState = {
  isPlaying: boolean;
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
  const [isPlaying, setIsPlaying] = useState(false);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    // Reload the stream on every play so we never resume from a stale buffer.
    audio.src = STREAM_URL;
    audio.load();
    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      // Autoplay/permission blocked — leave UI in paused state.
      setIsPlaying(false);
    }
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  // Keep React state in sync if the browser pauses for us (network drop, etc.)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  return (
    <PlayerContext.Provider value={{ isPlaying, toggle, play, pause }}>
      {/* Single shared audio element — never unmounted. */}
      <audio ref={audioRef} preload="none" />
      {children}
    </PlayerContext.Provider>
  );
}
