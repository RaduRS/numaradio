"use client";
import { useEffect, useState, type RefObject } from "react";
import { PlayIcon, PauseIcon, XIcon } from "lucide-react";

type Props = {
  audioRef: RefObject<HTMLAudioElement | null>;
  trackTitle: string;
  trackArtist: string | null;
  artworkUrl: string | null;
  /** Toggles play/pause on the shared audio element. */
  onTogglePlay: () => void;
  /** Stops playback and closes the bar. */
  onClose: () => void;
};

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export function LibraryPreviewBar({ audioRef, trackTitle, trackArtist, artworkUrl, onTogglePlay, onClose }: Props) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  // While the user is dragging the slider, don't fight them with timeupdate
  // events from the audio element. Snap to the audio's clock once they release.
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => { if (!scrubbing) setCurrentTime(audio.currentTime); };
    const onMeta = () => setDuration(audio.duration || 0);
    const onPause = () => setPaused(true);
    const onPlay = () => setPaused(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    // Sync immediately on mount/track-change
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || 0);
    setPaused(audio.paused);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, [audioRef, scrubbing, trackTitle]);

  function seek(toSec: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration || toSec, toSec));
    setCurrentTime(audio.currentTime);
  }

  return (
    <div
      role="region"
      aria-label="Library preview player"
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-bg-1/98 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.35)]"
    >
      <div className="mx-auto flex w-full max-w-[1440px] items-center gap-4 px-4 py-3 sm:px-6">
        {artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artworkUrl} alt="" className="h-10 w-10 rounded-md object-cover bg-bg shrink-0 border border-line" />
        ) : (
          <div className="h-10 w-10 rounded-md bg-bg shrink-0 border border-line" aria-hidden />
        )}
        <div className="min-w-0 w-[180px] sm:w-[240px] shrink-0">
          <div className="truncate text-sm text-fg" title={trackTitle}>{trackTitle}</div>
          {trackArtist ? (
            <div className="truncate text-xs text-fg-mute font-mono" title={trackArtist}>{trackArtist}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={paused ? "Play" : "Pause"}
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-accent text-accent hover:bg-[var(--accent-soft)] transition-colors"
        >
          {paused ? <PlayIcon size={14} strokeWidth={2} /> : <PauseIcon size={14} strokeWidth={2} />}
        </button>
        <span className="font-mono text-[11px] tabular-nums text-fg-mute shrink-0 w-10 text-right">
          {fmtTime(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onMouseDown={() => setScrubbing(true)}
          onTouchStart={() => setScrubbing(true)}
          onChange={(e) => setCurrentTime(Number(e.target.value))}
          onMouseUp={(e) => { seek(Number((e.target as HTMLInputElement).value)); setScrubbing(false); }}
          onTouchEnd={(e) => { seek(Number((e.target as HTMLInputElement).value)); setScrubbing(false); }}
          aria-label="Scrub"
          className="flex-1 accent-[var(--accent)] cursor-pointer"
        />
        <span className="font-mono text-[11px] tabular-nums text-fg-mute shrink-0 w-10">
          {fmtTime(duration)}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          title="Close preview"
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-fg-mute hover:text-fg hover:bg-[var(--bg-2)] transition-colors"
        >
          <XIcon size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
