// Scrape public metadata from a Suno song page.
//
// Suno's own ID3 export (as of 2026-04) no longer embeds BPM / key / genre —
// only freeform hashtags in the comment field. The song page itself, however,
// server-renders the full metadata into a Next.js RSC streaming chunk:
//
//   "metadata":{"tags":"Deep House, Moody Atmospheric.\nBPM: 116. Key: C Minor.\n..."}
//
// We fetch that page, pluck the tags blob, and parse structured fields out of
// it. Resilient-ish: if Suno changes format we just return what we can.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export type SunoMetadata = {
  bpm?: number;
  musicalKey?: string;
  genres: string[];
  moods: string[];
  durationSeconds?: number;
  modelVersion?: string;
  rawTags?: string;
};

export type FetchSunoResult =
  | { ok: true; data: SunoMetadata }
  | { ok: false; reason: "not_found" | "no_metadata" | "network_error"; detail?: string };

export async function fetchSunoMetadata(uuid: string): Promise<FetchSunoResult> {
  const url = `https://suno.com/song/${uuid}`;
  let html: string;
  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (r.status === 404) return { ok: false, reason: "not_found" };
    if (!r.ok) {
      return { ok: false, reason: "network_error", detail: `HTTP ${r.status}` };
    }
    html = await r.text();
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // The metadata object is JSON inside a Next RSC streaming chunk, which is
  // itself a JSON-encoded string. That means every " in the inner JSON is
  // rendered as \" and every \ is \\ in the HTML bytes. So a newline in the
  // final tags string shows up as \\n (three chars) in the source, and the
  // closing quote of the tags value is \" NOT preceded by another \.
  const tagsMatch = html.match(
    /\\"metadata\\":\{\\"tags\\":\\"([\s\S]*?)(?<!\\)\\"/,
  );
  if (!tagsMatch) return { ok: false, reason: "no_metadata" };

  // Two levels of JSON unescape: RSC-outer, then JSON-inner.
  let rawTags: string | undefined;
  try {
    const level1 = JSON.parse(`"${tagsMatch[1]}"`) as string;
    rawTags = JSON.parse(`"${level1.replace(/"/g, '\\"')}"`) as string;
  } catch {
    // Escape-weirdness fallback: the raw match is still useful even if the
    // double-unescape failed (rare).
    rawTags = tagsMatch[1].replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
  }

  const durationMatch = html.match(/\\"duration\\":\s*([0-9.]+)/);
  const modelMatch = html.match(/\\"model_name\\":\\"([^"\\]+)\\"/);

  return {
    ok: true,
    data: {
      ...parseTags(rawTags),
      durationSeconds: durationMatch
        ? Math.round(parseFloat(durationMatch[1]))
        : undefined,
      modelVersion: modelMatch?.[1],
      rawTags,
    },
  };
}

// Parse the freeform tags string Suno renders into the song page. Format is
// loose — multiple comma/period-separated sentences. We look for:
//   * BPM: 116.
//   * Key: C Minor.   (also "Key: C# Major", "Key: Eb Major")
//   * Mood: mysterious, dark, cool, hypnotic.
//   * the first line, which is a comma-separated list of genre-ish labels
export function parseTags(tags: string): {
  bpm?: number;
  musicalKey?: string;
  genres: string[];
  moods: string[];
} {
  // Require the ":" after each label — otherwise "Mood" matches "Moody"
  // (the first word of genres like "Moody Atmospheric") and we get garbage.
  const bpmMatch = tags.match(/\bBPM\s*:\s*(\d{2,3})\b/i);
  const keyMatch = tags.match(
    /\bKey\s*:\s*([A-G](?:#|b|♭)?)\s+(Major|Minor|Maj|Min)\b/i,
  );
  const moodMatch = tags.match(/\bMood\s*:\s*([^\n.]+)/i);

  // First line (before the first newline OR before "Production:"/"Vocals:").
  // Some Suno tags start with a label prefix like "Genre: Nu-Disco, ..." —
  // strip those before splitting so we don't capture "Genre: Nu-Disco" as a
  // literal genre.
  const firstLine = (tags.split(/\n|(?=Production:|Vocals:)/)[0] ?? "").replace(
    /^(Genre|Style|Vibe|Tags?)\s*:\s*/i,
    "",
  );
  const genres = firstLine
    .split(/,|;|\./)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        s.length < 40 &&
        !/^(BPM|Key|Mood|Production|Vocals)\b/i.test(s),
    );

  const moods = moodMatch
    ? moodMatch[1]
        .split(/,|;/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length < 30)
    : [];

  const musicalKey = keyMatch
    ? `${keyMatch[1]} ${normalizeKeyFlavor(keyMatch[2])}`
    : undefined;

  return {
    bpm: bpmMatch ? parseInt(bpmMatch[1], 10) : undefined,
    musicalKey,
    genres,
    moods,
  };
}

function normalizeKeyFlavor(flavor: string): string {
  return flavor.replace(/^Maj$/i, "Major").replace(/^Min$/i, "Minor");
}
