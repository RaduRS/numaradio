"use client";

import { useState } from "react";
import { ShareIcon } from "./Icons";
import { useNowPlaying } from "./useNowPlaying";

const SHARE_URL = "https://numaradio.com";

type Nav = Navigator & {
  share?: (data: ShareData) => Promise<void>;
};

export function ShareControls() {
  const np = useNowPlaying();
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const title = np.title ?? "Numa Radio";
    const artist = np.artistDisplay ?? "";
    const text = artist
      ? `Listening to ${title} by ${artist} on Numa Radio`
      : `Listening to Numa Radio`;
    const nav = navigator as Nav;

    try {
      if (typeof nav.share === "function") {
        await nav.share({ title: "Numa Radio", text, url: SHARE_URL });
        return;
      }
    } catch (err) {
      // User aborted, or share failed — fall through to clipboard.
      if ((err as DOMException)?.name === "AbortError") return;
    }

    try {
      await navigator.clipboard.writeText(`${text} — ${SHARE_URL}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context, etc.) — last resort.
      window.prompt("Copy this link", SHARE_URL);
    }
  };

  return (
    <div className="now-shares">
      <button
        className="share-pill"
        aria-label="Share"
        type="button"
        onClick={onShare}
      >
        <ShareIcon className="" />
        {copied ? "Copied!" : "Share"}
      </button>
    </div>
  );
}
