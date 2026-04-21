"use client";

import { ShareIcon } from "./Icons";

// TODO: wire real share onClick. Visual only for now — the parent must
// stopPropagation when this lives inside a clickable surface (PlayerCard).
export function ShareControls() {
  return (
    <div className="now-shares">
      <button className="share-pill" aria-label="Share" type="button">
        <ShareIcon className="" />
        Share
      </button>
    </div>
  );
}
