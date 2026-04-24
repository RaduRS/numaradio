"use client";

import { useEffect, useRef, useState } from "react";
import {
  CopyIcon,
  FacebookIcon,
  MailIcon,
  RedditIcon,
  ShareIcon,
  TelegramIcon,
  WhatsAppIcon,
  XIcon,
} from "./Icons";
import { useNowPlaying } from "./useNowPlaying";

const SHARE_URL = "https://numaradio.com";

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
    key: "telegram",
    label: "Telegram",
    icon: TelegramIcon,
    href: (text, url) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
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
  {
    key: "email",
    label: "Email",
    icon: MailIcon,
    href: (text, url) =>
      `mailto:?subject=${encodeURIComponent("Numa Radio")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
];

export function ShareControls() {
  const np = useNowPlaying();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
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

  return (
    <div className="now-shares" ref={rootRef}>
      <button
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

      {open && (
        <div className="share-menu" role="menu">
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
        </div>
      )}
    </div>
  );
}
