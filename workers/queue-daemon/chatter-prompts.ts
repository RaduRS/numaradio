export type ChatterType =
  | "back_announce"
  | "shoutout_cta"
  | "song_cta"
  | "filler";

// Hand-crafted 20-slot rotation: 10 back-announce, 3 shoutout CTA,
// 3 song CTA, 4 filler, no same-type adjacency.
//   slot:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
const ROTATION: readonly ChatterType[] = [
  "back_announce", "shoutout_cta", "back_announce", "filler",
  "back_announce", "song_cta",     "back_announce", "filler",
  "back_announce", "shoutout_cta", "back_announce", "song_cta",
  "back_announce", "filler",       "back_announce", "shoutout_cta",
  "back_announce", "filler",       "back_announce", "song_cta",
];

export function slotTypeFor(slotCounter: number): ChatterType {
  const idx = ((slotCounter % ROTATION.length) + ROTATION.length) % ROTATION.length;
  return ROTATION[idx];
}

export interface PromptContext {
  title?: string;
  artist?: string;
}

export interface PromptPair {
  system: string;
  user: string;
}

const BASE_SYSTEM = `You write a single short spoken line for Lena, a warm, low-energy late-night AI radio host on Numa Radio.

Constraints:
- Target roughly 40 words (30–50 is fine). This is ~15 seconds of voice.
- 2 to 4 short sentences. Contractions ("you're", "we're", "that's").
- Never mention "AI", "generated", "MiniMax", "Deepgram", or any tech word.
- Never invent listener names, locations, or facts not given in the user prompt.
- No ALL CAPS, no stage directions like [pause], no emojis, no markdown.
- Do not wrap the output in quotes. Output only the spoken line itself.`;

export function promptFor(type: ChatterType, ctx: PromptContext): PromptPair {
  switch (type) {
    case "back_announce": {
      const title = ctx.title ?? "that one";
      const artist = ctx.artist ?? "the artist";
      return {
        system: BASE_SYSTEM,
        user: `The track that just ended was "${title}" by ${artist}. Write Lena's back-announce: name the title and artist, add one short line of colour about the vibe (e.g. "soft percussion", "warm groove", "late-evening feel"), then gently hand off to the next song. Do not name or predict the next song.`,
      };
    }
    case "shoutout_cta":
      return {
        system: BASE_SYSTEM,
        user: `Write a call-to-action nudging listeners to send a shoutout. Mention the site numaradio.com and the Requests tab. Say Lena will read it out on air between songs. Keep it warm and low-pressure, not salesy.`,
      };
    case "song_cta":
      return {
        system: BASE_SYSTEM,
        user: `Write a call-to-action nudging listeners to generate a song. Mention the site numaradio.com and the Song Request tab. Explain they describe a mood or genre and a new track airs within minutes. Keep it warm, curious, low-pressure.`,
      };
    case "filler":
      return {
        system: BASE_SYSTEM,
        user: `Write a generic station-identification line for Numa Radio. Do not name any specific song, artist, or site feature. Tone: warm, present, "we're right here with you". Suitable for any time of day.`,
      };
  }
}
