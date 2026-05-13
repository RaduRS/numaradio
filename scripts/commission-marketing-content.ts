// One-shot — commission fresh English-prompted songs + Flux artwork
// for the marketing-launch-10 batch, bypassing the listener flow.
//
// Curated mood prompts only (no listener DB pulls). Each prompt goes
// through the production song-worker modules:
//   expandPrompt() → startMusicGeneration() → pollMusicGeneration()
//   → download MP3 → generateArtwork() → save PNG
//
// Output: numaradio-videos/src/data/marketing-songs.json + assets.

import "../lib/load-env.ts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expandPrompt } from "../workers/song-worker/prompt-expand.ts";
import {
  startMusicGeneration,
  pollMusicGeneration,
} from "../workers/song-worker/minimax.ts";
import { generateArtwork } from "../workers/song-worker/openrouter.ts";

const videosRoot = "/home/marku/saas/numaradio-videos";

const ASSETS_DIR = resolve(videosRoot, "src/assets/marketing-songs");
const INDEX_PATH = resolve(videosRoot, "src/data/marketing-songs.json");

interface MarketingSong {
  slug: string;
  prompt: string;
  title: string;
  audioFile: string;   // relative to src/assets/, e.g. "marketing-songs/<slug>.mp3"
  artworkFile: string; // relative to src/assets/, e.g. "marketing-songs/<slug>.png"
  durationSeconds: number | null;
  generatedAt: string;
}

// Three curated English mood prompts spanning emotional registers — the
// operator can choose which two land in the slate. All English, all
// short (under 60 chars to fit the on-screen card cleanly), all
// concrete enough that the LLM expands them faithfully.
const PROMPTS: { slug: string; prompt: string }[] = [
  {
    slug: "late-night-drive",
    prompt: "Late night drive home alone, slow and melancholy.",
  },
  {
    slug: "rainy-sunday",
    prompt: "Rainy Sunday morning, slow and warm, acoustic.",
  },
  {
    slug: "first-win",
    prompt: "First win after a long week, upbeat and triumphant.",
  },
];

async function commissionOne(
  slug: string,
  prompt: string,
): Promise<MarketingSong> {
  console.log(`\n[${slug}] expanding prompt…`);
  const expansion = await expandPrompt(prompt, { withLyrics: true });
  if (!expansion) throw new Error(`expandPrompt returned null for ${slug}`);
  console.log(`[${slug}]   title: ${expansion.title}`);
  console.log(`[${slug}]   artwork prompt: ${expansion.artworkPrompt.slice(0, 80)}…`);
  console.log(`[${slug}]   lyrics: ${expansion.lyrics?.length ?? 0} chars`);

  console.log(`[${slug}] starting music generation…`);
  const start = await startMusicGeneration({
    prompt: prompt,
    lyrics: expansion.lyrics,
    isInstrumental: false,
  });

  let audioUrl: string | undefined = start.immediateAudioUrl;
  let durationMs: number | undefined = start.durationMs;

  if (!audioUrl) {
    console.log(`[${slug}] polling task ${start.taskId}…`);
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      const poll = await pollMusicGeneration(start.taskId);
      if (poll.status === "done") {
        audioUrl = poll.audioUrl;
        durationMs = poll.durationMs;
        break;
      }
      if (poll.status === "failed") {
        throw new Error(`music gen failed: ${poll.failureReason}`);
      }
      process.stdout.write(".");
    }
    process.stdout.write("\n");
    if (!audioUrl) throw new Error(`music gen timeout for ${slug}`);
  }

  console.log(`[${slug}] downloading audio…`);
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`audio download ${audioRes.status}`);
  const audioBuf = Buffer.from(await audioRes.arrayBuffer());
  const audioPath = resolve(ASSETS_DIR, `${slug}.mp3`);
  writeFileSync(audioPath, audioBuf);
  console.log(`[${slug}]   wrote ${audioPath} (${(audioBuf.length / 1_048_576).toFixed(1)} MB)`);

  console.log(`[${slug}] generating Flux artwork…`);
  const artworkBuf = await generateArtwork(expansion.artworkPrompt);
  const artworkPath = resolve(ASSETS_DIR, `${slug}.png`);
  writeFileSync(artworkPath, artworkBuf);
  console.log(`[${slug}]   wrote ${artworkPath} (${(artworkBuf.length / 1024).toFixed(0)} KB)`);

  return {
    slug,
    prompt,
    title: expansion.title,
    audioFile: `marketing-songs/${slug}.mp3`,
    artworkFile: `marketing-songs/${slug}.png`,
    durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });

  const existing: MarketingSong[] = existsSync(INDEX_PATH)
    ? JSON.parse(readFileSync(INDEX_PATH, "utf8"))
    : [];

  const filter = process.argv[2];
  const todo = filter
    ? PROMPTS.filter((p) => p.slug === filter || p.slug.includes(filter))
    : PROMPTS;

  if (todo.length === 0) {
    console.error(`no prompts matched filter: ${filter}`);
    process.exit(2);
  }

  const results: MarketingSong[] = [];
  for (const { slug, prompt } of todo) {
    try {
      const song = await commissionOne(slug, prompt);
      results.push(song);
    } catch (e) {
      console.error(`\n[${slug}] FAILED: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  // Merge: existing entries that weren't re-commissioned + new ones.
  const merged = [
    ...existing.filter((e) => !results.find((r) => r.slug === e.slug)),
    ...results,
  ];
  writeFileSync(INDEX_PATH, JSON.stringify(merged, null, 2));

  console.log(`\n✓ ${results.length}/${todo.length} commissioned. Index: ${INDEX_PATH}`);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
