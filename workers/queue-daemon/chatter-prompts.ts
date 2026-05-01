import { SHOW_SCHEDULE, type ShowBlock, type TimeOfDay } from "../../lib/schedule.ts";

export type ChatterType =
  | "back_announce"
  | "shoutout_cta"
  | "song_cta"
  | "filler"
  // Tier 2.5 — short Lena aside about a real outside-world fact (weather,
  // music news, AI news, on-this-day, light culture trend, astronomical
  // event). Externally supplied by NanoClaw via Brave Search; promptFor()
  // throws for this type since no local prompt is built. Gated by the
  // worldAside toggle in StationConfig — when the toggle says no or the
  // NanoClaw call fails, the slot is demoted to "filler" before generation.
  // Spec: docs/superpowers/specs/2026-04-26-lena-world-aside-design.md.
  | "world_aside"
  // Event-driven — fires on the FIRST air of a listener-generated song.
  // Not part of the ROTATION table below; used by the daemon's announce
  // flow, not the auto-chatter orchestrator.
  | "listener_song_announce";

// Hand-crafted 20-slot rotation: 7 back-announce, 3 shoutout CTA,
// 3 song CTA, 1 filler, 6 world-aside, no same-type adjacency
// (verified across the slot-19 → slot-0 wrap). World asides land at
// 1 / 4 / 7 / 10 / 13 / 16 — every 3 slots, perfectly even. Filler
// safety net at 14 keeps listeners covered if every world_aside in a
// cycle fails. Brave API budget is ~48 calls/day at 1 cycle ≈ 3h,
// well under the 2000/month free tier.
//   slot:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
const ROTATION: readonly ChatterType[] = [
  "shoutout_cta", "world_aside",   "song_cta",     "back_announce",
  "world_aside",  "back_announce", "shoutout_cta", "world_aside",
  "song_cta",     "back_announce", "world_aside",  "back_announce",
  "shoutout_cta", "world_aside",   "filler",       "back_announce",
  "world_aside",  "back_announce", "song_cta",     "back_announce",
];

export function slotTypeFor(slotCounter: number): ChatterType {
  const idx = ((slotCounter % ROTATION.length) + ROTATION.length) % ROTATION.length;
  return ROTATION[idx];
}

export interface PromptContext {
  title?: string;
  artist?: string;
  /** The current show block from lib/schedule.ts. Optional — passed as DJ-riff context. */
  currentShow?: ShowBlock;
  /** Last 3 aired artists, newest-first. Enables "second Russell Ross in a row" riffs. */
  recentArtists?: string[];
  /** Current slotCounter % 20. Enables mild "few songs in" / "cruising" flavor. */
  slotsSinceOpening?: number;
  /** Local wall-clock time as HH:MM (24h). Enables "this morning" / "tonight" phrasing. */
  localTime?: string;
  /** DJ-plain time-of-day bucket — "morning" / "afternoon" / "evening" / "night" / "late night". */
  timeOfDay?: TimeOfDay;
}

export interface AnnouncementContext {
  listenerName: string;
  userPrompt: string;
  title: string;
}

export interface PromptPair {
  system: string;
  user: string;
}

const BASE_SYSTEM = `You write ONE short spoken line for Lena, a radio DJ on Numa Radio. She sounds like a calm, slightly-studio-slang DJ who's seen a thousand shifts. Not a poet. Not a vibe-setter. A real DJ on comms.

Length: 35–50 words total. 2 or 3 short sentences. Use contractions. Spoken-style, not written-style.

ACTIVELY ENCOURAGE:
- One beat of non-music riff per break — a small observation, a rhetorical question, a casual callout to listeners, a light station-vibe line, or a soft teaser about what's coming. One beat, not a paragraph.
- Specific-but-short reactions instead of only "good one": "hook on that chorus", "real earworm", "that bassline", "chorus landed". Still brief, still spoken.
- Varied signoffs: rotate across "you're on Numa Radio", "stay close", "more ahead", "keep it locked", "we'll keep it rolling", "sticking with you". Not every line needs a signoff.

DO NOT:
- Describe the music poetically. No "wandering piano lines", no "dawn peeking through curtains", no "warm hum", no "gentle percussion", no "soft glow", no "the night settles", no "ease into".
- Stack adjectives about the track itself. "Soft, wandering, gentle, warm" is four too many.
- Use atmospheric/mood language applied to the song ("dreamy", "late-night", "intimate", "cozy", "settling in").
- Mention AI, tech, generation, MiniMax, Deepgram, or how songs are made.
- Invent listener names, specific places, weather, or emotions the system didn't tell you about. (If a Context block below names a show, artist, or local time, you MAY weave it in — match the time-of-day word to the Local time given, and don't invent one if it isn't provided.)
- Write ALL CAPS, stage directions, emojis, markdown, or quotes around the output.

If you catch yourself reaching for poetic description, stop and cut it. If you catch yourself writing the same skeleton as the examples, break the skeleton. Real DJ, real variety.`;

function renderContextBlock(ctx: PromptContext): string {
  const lines: string[] = [];
  if (ctx.localTime) {
    const bucket = ctx.timeOfDay ? ` (${ctx.timeOfDay})` : "";
    lines.push(`- Local time: ${ctx.localTime}${bucket}`);
  } else if (ctx.timeOfDay) {
    lines.push(`- Time of day: ${ctx.timeOfDay}`);
  }
  if (ctx.currentShow) {
    const slot = SHOW_SCHEDULE.find((s) => s.name === ctx.currentShow);
    const desc = slot ? ` — ${slot.description}` : "";
    lines.push(`- Current show: ${ctx.currentShow}${desc}`);
  }
  if (ctx.recentArtists && ctx.recentArtists.length > 0) {
    const n = ctx.recentArtists.length;
    lines.push(
      `- Last ${n} ${n === 1 ? "artist" : "artists"} aired (newest first): ${ctx.recentArtists.join(", ")}`,
    );
  }
  if (typeof ctx.slotsSinceOpening === "number") {
    lines.push(`- Position in the 20-slot rotation: ${ctx.slotsSinceOpening}`);
  }
  if (lines.length === 0) return "";
  return `

Context (optional, weave in only if natural — skip if it doesn't fit. You do NOT have to use any of these. If Local time is given, any time-of-day phrasing MUST match it; otherwise don't reach for one):
${lines.join("\n")}`;
}

export function promptFor(type: ChatterType, ctx: PromptContext): PromptPair {
  switch (type) {
    case "back_announce": {
      const title = ctx.title ?? "that one";
      const artist = ctx.artist ?? "the artist";
      return {
        system: BASE_SYSTEM,
        user: `The track that just ended was "${title}" by ${artist}. Write Lena's back-announce: name the title and artist, then weave in ONE of: a tiny specific reaction, a light non-music riff, a show-vibe callout, or a simple handoff. Do NOT describe the music. Do NOT name the next song. Do NOT write poetry.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton across calls; use a time-of-day word ONLY if Local time is given, and match it — the [bracketed tags] are metadata, never speak them aloud):
- "That was 'Neon Fever' by Russell Ross. Good one. Stay close, more ahead." [time-neutral]
- "Hook on that chorus, stuck with me. 'Neon Fever' from Russell Ross. You're on Numa Radio." [time-neutral]
- "Hope the evening's treating you alright. That was 'Neon Fever' by Russell Ross. More coming up." [use when evening]
- "Second Russell Ross back to back — he's holding the hour for us. 'Neon Fever' was the one. Stay close." [time-neutral]
- "Hope your morning's off to a decent one. That was 'Sunset' by Russell Ross. We'll keep it rolling." [use when morning]
- "That was 'Ocean Eyes' by Russell Ross, real earworm. Sticking with the vibe for a bit, more ahead." [time-neutral]

Bad examples (do NOT write anything like these):
- "a soft, wandering piano line that felt like dawn peeking through curtains"
- "let the night settle into your bones"
- "ease into what's coming next"
- any sentence describing the song's mood, instruments, or atmosphere${renderContextBlock(ctx)}`,
      };
    }
    case "shoutout_cta":
      return {
        system: BASE_SYSTEM,
        user: `Write a call-to-action nudging listeners to send a shoutout. Say they can drop one at numaradio.com under Requests, and Lena reads them on air between songs. Casual — like a DJ mentioning it once, not a sales pitch. One beat of riff around it is welcome.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton; use the time-of-day word ONLY if Local time is given, and match it):
- "Got something to say? Head to numaradio.com, Requests tab, drop me a shoutout. I read them here between tracks."
- "Anyone want a shoutout on air this morning? numaradio.com, Requests tab. Write what you want, I'll catch it." [use when Local time says morning]
- "Plenty of room for shoutouts this afternoon — numaradio.com, Requests. Tell me what's on your mind, I'll read it out." [use when afternoon]
- "Shoutouts open tonight. numaradio.com, Requests tab, drop a line — I'll read it between songs." [use when evening or night]
- "Quiet hour in the inbox. If you want a shoutout, numaradio.com, Requests. I'll read it out right here." [time-neutral — safe anytime]
- "If there's someone you're listening with, send them a shoutout. numaradio.com, Requests tab, I'll do the rest." [time-neutral]${renderContextBlock(ctx)}`,
      };
    case "song_cta":
      return {
        system: BASE_SYSTEM,
        user: `Write a call-to-action nudging listeners to generate a song. Say they can head to numaradio.com, Song Request tab, describe a mood or genre, and a new track airs here within minutes. Casual — not a sales pitch. One beat of riff is welcome.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton):
- "Got a mood? numaradio.com, Song Request tab. Tell me what you want, I'll make it, airs here in a few minutes."
- "Want your own track on air? numaradio.com, hit Song Request, describe it. Your song plays here shortly."
- "If there's a sound rattling around your head, I can build it. numaradio.com, Song Request tab, I take it from there."
- "Head to numaradio.com, Song Request, tell me a genre or a tempo. I'll have something airing here in a few."
- "Fresh one coming up for whoever wants to order it — numaradio.com, Song Request. I'll air it soon as it's done."
- "Feel like hearing something that doesn't exist yet? Song Request tab at numaradio.com. I make it, you hear it here."${renderContextBlock(ctx)}`,
      };
    case "filler":
      return {
        system: BASE_SYSTEM,
        user: `Write a generic station-ID line for Numa Radio. No specific songs, artists, or site features. Just a DJ saying hi to listeners in plain words. A single beat of riff (show name, time-of-day vibe) is welcome if a Context block is provided below.

Good example shapes (write a fresh one — do NOT copy verbatim; vary the skeleton; use a time-of-day word ONLY if Local time is given, and match it):
- "You're with Lena on Numa Radio. Good to have you here." [time-neutral]
- "Numa Radio, always on. Thanks for riding with me this morning." [use when morning]
- "Numa Radio this afternoon, I'm Lena. More ahead." [use when afternoon]
- "Numa Radio, always on. Thanks for riding with me tonight." [use when evening or night]
- "You're listening to Numa Radio. More music coming up, stay close." [time-neutral]
- "Numa Radio, I'm Lena — hope you're having a decent one. More ahead." [time-neutral]${renderContextBlock(ctx)}`,
      };
    case "world_aside":
      throw new Error(
        "world_aside is externally supplied by NanoClaw — promptFor() must not be called for it",
      );
    case "listener_song_announce":
      throw new Error(
        "listener_song_announce uses announcementPrompt(), not promptFor()",
      );
  }
}

export function announcementPrompt(ctx: AnnouncementContext): PromptPair {
  return {
    system: BASE_SYSTEM,
    user: `A brand-new LISTENER-GENERATED song is about to air for the first time. Write Lena's intro — she speaks over the opening seconds of the song and welcomes the track in.

Context:
- Listener's artist name: ${ctx.listenerName}
- What the listener asked for: ${ctx.userPrompt}
- Song title: ${ctx.title}

Shape: mention it's a fresh/new listener song, include the listener's name, briefly paraphrase what they wanted (reword casually, don't quote the prompt verbatim), and include the title. Keep it DJ-plain — "here's a fresh one for you" energy.

Good example shapes (write a fresh one, don't copy verbatim):
- "Here's a fresh one just made for ${ctx.listenerName} — they asked for something chill. This is '${ctx.title}'. Enjoy."
- "A brand new track from ${ctx.listenerName} on Numa Radio. They wanted a warm groove. '${ctx.title}', here we go."
- "Just in, a new listener song from ${ctx.listenerName}. '${ctx.title}' — check it out."

Do NOT: describe the music poetically, stack adjectives, mention AI/generation/how it was made, or use atmospheric/mood language.`,
  };
}
