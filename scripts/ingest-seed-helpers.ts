import { readFile, access } from "node:fs/promises";
import type { ShowBlock } from "@prisma/client";

const SHOW_HASHTAG_MAP: Record<string, ShowBlock> = {
  nightshift: "night_shift",
  morningroom: "morning_room",
  daylightchannel: "daylight_channel",
  primehours: "prime_hours",
};

export function parseShowHashtag(text: string): ShowBlock | null {
  const tags = [...text.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase());
  for (const t of tags) {
    const mapped = SHOW_HASHTAG_MAP[t];
    if (mapped) return mapped;
  }
  return null;
}

export async function resolveShowFromHashtagOrSidecar(opts: {
  mp3Path: string;
  commentText: string;
}): Promise<ShowBlock> {
  const fromHashtag = parseShowHashtag(opts.commentText);
  if (fromHashtag) return fromHashtag;

  const sidecarPath = `${opts.mp3Path}.show`;
  try {
    await access(sidecarPath);
  } catch {
    throw new Error(
      `Track at ${opts.mp3Path} must include a show hashtag (e.g. #MorningRoom) ` +
      `in its ID3 comment, or a "${sidecarPath}" sidecar file containing one of: ` +
      `night_shift, morning_room, daylight_channel, prime_hours.`,
    );
  }
  const raw = (await readFile(sidecarPath, "utf-8")).trim();
  const valid: ShowBlock[] = ["night_shift", "morning_room", "daylight_channel", "prime_hours"];
  if (!valid.includes(raw as ShowBlock)) {
    throw new Error(`Sidecar ${sidecarPath} contains "${raw}" — expected one of ${valid.join(", ")}`);
  }
  return raw as ShowBlock;
}
