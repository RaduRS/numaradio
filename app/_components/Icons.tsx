// Shared SVG icons. Keep one canonical glyph per concept (per the design's
// icon system: same action = same icon, everywhere on the page).

export function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M4 3v14l12-7z" />
    </svg>
  );
}

export function PauseIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M5 3h4v14H5zM11 3h4v14h-4z" />
    </svg>
  );
}

export function MusicNoteIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M17 3v10.2a3 3 0 11-2-2.8V6l-7 2v7.2a3 3 0 11-2-2.8V5l11-2z" />
    </svg>
  );
}

export function MegaphoneIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <path d="M3 6h8l5-3v14l-5-3H3z" />
      <path d="M7 14v3" />
    </svg>
  );
}

export function SendIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M2 10l16-7-4 17-4-7-8-3z" />
    </svg>
  );
}

export function ShareIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className={className}
    >
      <path d="M7 9l6-4M7 11l6 4M5 10a2 2 0 100-4 2 2 0 000 4zM5 14a2 2 0 100 4 2 2 0 000-4zM15 5a2 2 0 100-4 2 2 0 000 4zM15 19a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  );
}

export function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M8 12a3 3 0 014 0l2-2a3 3 0 10-4-4l-1 1M12 8a3 3 0 01-4 0l-2 2a3 3 0 104 4l1-1" />
    </svg>
  );
}

export function BlueskyIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 7c-2-3-5-4-7-4 0 2 0 5 2 6 1 1 3 1 4 1-1 0-4 0-5 1-2 1-1 4 0 5s4 2 6-2c2 4 5 3 6 2s2-4 0-5c-1-1-4-1-5-1 1 0 3 0 4-1 2-1 2-4 2-6-2 0-5 1-7 4z" />
    </svg>
  );
}

export function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2a8 8 0 00-7 12l-1 4 4-1a8 8 0 107-15zm3 11c0 1-2 2-3 2-1 0-3-1-4-2s-3-3-3-5c0-1 1-3 2-3h1l1 2-1 1c0 1 2 3 3 3l1-1 2 1v2z" />
    </svg>
  );
}

export function InstagramIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <rect x="3" y="3" width="14" height="14" rx="4" />
      <circle cx="10" cy="10" r="3" />
      <circle cx="14.5" cy="5.5" r="0.7" fill="currentColor" />
    </svg>
  );
}

export function MastodonIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2c-4 0-6 2-6 5v5c0 2 1 4 4 4l4-1v-2l-3 1c-2 0-3-1-3-2h9V7c0-3-2-5-5-5zm-2 4h1v4H8V6zm3 0h1v4h-1V6z" />
    </svg>
  );
}

export function RssIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <circle cx="5" cy="15" r="1.5" />
      <path d="M3 10a7 7 0 017 7h-2a5 5 0 00-5-5v-2zM3 5a12 12 0 0112 12h-2A10 10 0 003 7V5z" />
    </svg>
  );
}

export function QueueIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M4 5h12M4 10h12M4 15h8" />
    </svg>
  );
}

export function ChevronUpRightArrow({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12" />
    </svg>
  );
}
