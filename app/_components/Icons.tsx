// Icon wrappers — delegate to lucide-react (general glyphs) and
// @icons-pack/react-simple-icons (brand glyphs). Keep these names stable so
// the rest of the app doesn't need to know which library backs each icon.

import {
  ArrowUpRight,
  Link as LucideLink,
  ListMusic,
  Loader2,
  Megaphone,
  Music2,
  Pause,
  Play,
  Rss,
  Send,
  Share2,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import {
  SiBluesky,
  SiInstagram,
  SiMastodon,
  SiWhatsapp,
} from "@icons-pack/react-simple-icons";

type IconProps = { className?: string; size?: number };

// Filled triangle Play matches the original design's visual weight better
// than lucide's default outline rendering.
export function PlayIcon({ className = "", size }: IconProps) {
  return <Play className={className} size={size} fill="currentColor" strokeWidth={0} />;
}

export function PauseIcon({ className = "", size }: IconProps) {
  return <Pause className={className} size={size} fill="currentColor" strokeWidth={0} />;
}

export function MusicNoteIcon({ className = "", size }: IconProps) {
  return <Music2 className={className} size={size} fill="currentColor" strokeWidth={0} />;
}

export function MegaphoneIcon({ className = "", size }: IconProps) {
  return <Megaphone className={className} size={size} strokeWidth={1.6} />;
}

export function SendIcon({ className = "", size }: IconProps) {
  return <Send className={className} size={size} fill="currentColor" strokeWidth={0} />;
}

export function ShareIcon({ className = "", size }: IconProps) {
  return <Share2 className={className} size={size} strokeWidth={1.5} />;
}

export function CopyIcon({ className = "", size }: IconProps) {
  // "Copy link" affordance — the Link glyph reads more clearly than a
  // document-copy icon.
  return <LucideLink className={className} size={size} strokeWidth={1.6} />;
}

export function QueueIcon({ className = "", size }: IconProps) {
  return <ListMusic className={className} size={size} strokeWidth={1.6} />;
}

export function ChevronUpRightArrow({ className = "", size }: IconProps) {
  return <ArrowUpRight className={className} size={size} strokeWidth={1.6} />;
}

export function LoadingIcon({ className = "", size }: IconProps) {
  return <Loader2 className={`animate-spin ${className}`} size={size} strokeWidth={2} />;
}

// ── Brand glyphs (Simple Icons) ─────────────────────────────────

export function BlueskyIcon({ className = "", size }: IconProps) {
  return <SiBluesky className={className} size={size} />;
}

export function WhatsAppIcon({ className = "", size }: IconProps) {
  return <SiWhatsapp className={className} size={size} />;
}

export function InstagramIcon({ className = "", size }: IconProps) {
  return <SiInstagram className={className} size={size} />;
}

export function MastodonIcon({ className = "", size }: IconProps) {
  return <SiMastodon className={className} size={size} />;
}

export function RssIcon({ className = "", size }: IconProps) {
  return <Rss className={className} size={size} strokeWidth={1.6} />;
}

export function ThumbsUpIcon({ className = "", size }: IconProps) {
  return <ThumbsUp className={className} size={size} strokeWidth={1.8} />;
}

export function ThumbsDownIcon({ className = "", size }: IconProps) {
  return <ThumbsDown className={className} size={size} strokeWidth={1.8} />;
}

// "Numa writes you a song" CTA glyph — sparkles reads as AI-generated
// rather than Music2's "play this existing song" connotation.
export function SparklesIcon({ className = "", size }: IconProps) {
  return <Sparkles className={className} size={size} strokeWidth={1.8} />;
}
