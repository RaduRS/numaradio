// workers/queue-daemon/lena-producer/queue-director.ts

import { genreFitsShow, type ShowBlockName } from "../../../lib/show-genre-fit.ts";

export interface ProposedTrack {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

export interface CurrentTrack {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

export type QueueDirectorResult =
  | { ok: true }
  | { ok: false; reason: "recently_aired" | "same_artist_too_soon" | "wrong_show_block" };

const DOUBLE_FEATURE_HINT = /\b(double[- ]?feature|spotlight)\b/i;

export function queueDirectorDecide(args: {
  proposedTrack: ProposedTrack;
  currentTrack: CurrentTrack | null;
  /** Track ids aired in the last 60 minutes. */
  recentTrackIds: readonly string[];
  currentShow: ShowBlockName;
  /** Producer's stated reason — used to allow deliberate "double feature" exceptions. */
  reason: string;
}): QueueDirectorResult {
  // 1. Recently aired check
  if (args.recentTrackIds.includes(args.proposedTrack.id)) {
    return { ok: false, reason: "recently_aired" };
  }

  // 2. Same artist as currently playing — unless deliberate double feature
  if (
    args.currentTrack &&
    args.currentTrack.artist &&
    args.proposedTrack.artist &&
    args.currentTrack.artist.toLowerCase() === args.proposedTrack.artist.toLowerCase() &&
    !DOUBLE_FEATURE_HINT.test(args.reason)
  ) {
    return { ok: false, reason: "same_artist_too_soon" };
  }

  // 3. Genre must fit current show
  if (!genreFitsShow(args.proposedTrack.genre, args.currentShow)) {
    return { ok: false, reason: "wrong_show_block" };
  }

  return { ok: true };
}
