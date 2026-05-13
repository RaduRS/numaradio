// One-shot — synth short Vertex Leda voice-overs for the launch-10
// non-shoutout pieces. Output: numaradio-videos/src/assets/marketing-voice/.

import "../lib/load-env.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { synthesizeVertex } from "../workers/queue-daemon/vertex-tts.ts";

const videosRoot = "/home/marku/saas/numaradio-videos";

// GOOGLE_CLOUD_PROJECT lives in dashboard env, not main env.
// synthesizeVertex reads project from opts (passed at call time) so this
// can run after the imports — env just needs to be set when main() runs.
const dashboardEnv = "/home/marku/saas/numaradio/dashboard/.env.local";
if (existsSync(dashboardEnv)) loadDotenv({ path: dashboardEnv, override: false });

const OUT_DIR = resolve(videosRoot, "src/assets/marketing-voice");

interface VoiceClip {
  slug: string;
  text: string;
}

const CLIPS: VoiceClip[] = [
  {
    slug: "listen-now-coldopen",
    text: "There's a radio station that runs itself. Press play.",
  },
  {
    slug: "magic-loop-payoff",
    text: "You type. I read. The radio responds.",
  },
  {
    slug: "song-intro-late-night-drive",
    text: "A listener typed: late night drive home alone. Watch what Numa made.",
  },
  {
    slug: "song-intro-first-win",
    text: "First win after a long week. Here's what came back.",
  },
];

async function commission(clip: VoiceClip): Promise<void> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not set");

  console.log(`[${clip.slug}] synth: "${clip.text}"`);
  const mp3 = await synthesizeVertex(clip.text, { project });
  const path = resolve(OUT_DIR, `${clip.slug}.mp3`);
  writeFileSync(path, mp3);
  console.log(`[${clip.slug}]   wrote ${path} (${(mp3.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  for (const clip of CLIPS) {
    try {
      await commission(clip);
    } catch (e) {
      console.error(`[${clip.slug}] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n✓ done — ${CLIPS.length} clips in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
