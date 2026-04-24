"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CopyIcon,
  FacebookIcon,
  RedditIcon,
  ShareIcon,
  WhatsAppIcon,
  XIcon,
} from "./Icons";
import { useNowPlaying } from "./useNowPlaying";

const SHARE_URL = "https://numaradio.com";
const MENU_WIDTH = 180;
const MENU_GAP = 6;

type Target = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  href: (text: string, url: string) => string;
};

const TARGETS: Target[] = [
  {
    key: "x",
    label: "X",
    icon: XIcon,
    href: (text, url) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: WhatsAppIcon,
    href: (text, url) =>
      `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: FacebookIcon,
    href: (text, url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
  },
  {
    key: "reddit",
    label: "Reddit",
    icon: RedditIcon,
    href: (text, url) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
  },
];

export function ShareControls() {
  const np = useNowPlaying();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the menu relative to the button in viewport coords. Flips above
  // the button when there isn't room below, and clamps into the viewport.
  const reposition = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 240;
    const below = window.innerHeight - r.bottom;
    const openUp = below < menuH + MENU_GAP + 8 && r.top > menuH + MENU_GAP + 8;
    const top = openUp ? r.top - menuH - MENU_GAP : r.bottom + MENU_GAP;
    let left = r.left;
    if (left + MENU_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - MENU_WIDTH - 8;
    }
    if (left < 8) left = 8;
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => reposition();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const title = np.title ?? "Numa Radio";
  const artist = np.artistDisplay ?? "";
  const text = artist
    ? `Listening to ${title} by ${artist} on Numa Radio`
    : `Listening to Numa Radio`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${text} — ${SHARE_URL}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this link", SHARE_URL);
    }
  };

  const menu = open && pos && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          className="share-menu"
          role="menu"
          style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
        >
          {TARGETS.map((t) => {
            const Icon = t.icon;
            return (
              <a
                key={t.key}
                className="share-menu-item"
                role="menuitem"
                href={t.href(text, SHARE_URL)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <Icon className="" size={14} />
                <span>{t.label}</span>
              </a>
            );
          })}
          <button
            className="share-menu-item"
            role="menuitem"
            type="button"
            onClick={() => {
              onCopy();
              setOpen(false);
            }}
          >
            <CopyIcon className="" size={14} />
            <span>Copy link</span>
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="now-shares">
      <button
        ref={btnRef}
        className="share-pill"
        aria-label="Share"
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        <ShareIcon className="" />
        {copied ? "Copied!" : "Share"}
      </button>
      {menu}
    </div>
  );
}
