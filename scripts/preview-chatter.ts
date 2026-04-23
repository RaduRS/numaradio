#!/usr/bin/env -S node --experimental-strip-types

import "../lib/load-env.ts";
import { promptFor, type ChatterType } from "../workers/queue-daemon/chatter-prompts.ts";
import { generateChatterScript } from "../workers/queue-daemon/minimax-script.ts";
import { showForHour } from "../lib/schedule.ts";

interface Sample {
  type: ChatterType;
  context: Parameters<typeof promptFor>[1];
}

const HOUR = new Date().getHours();
const SHOW = showForHour(HOUR).name;

const SAMPLES: Sample[] = [
  // 2× back_announce — one with context, one minimal
  {
    type: "back_announce",
    context: {
      title: "Neon Fever",
      artist: "Russell Ross",
      currentShow: SHOW,
      recentArtists: ["Russell Ross", "Numa Radio", "Russell Ross"],
      slotsSinceOpening: 4,
    },
  },
  {
    type: "back_announce",
    context: { title: "Ocean Eyes", artist: "Russell Ross" },
  },
  // 2× shoutout_cta
  { type: "shoutout_cta", context: { currentShow: SHOW, slotsSinceOpening: 9 } },
  { type: "shoutout_cta", context: {} },
  // 2× song_cta
  { type: "song_cta", context: { currentShow: SHOW, slotsSinceOpening: 11 } },
  { type: "song_cta", context: {} },
  // 2× filler
  { type: "filler", context: { currentShow: SHOW } },
  { type: "filler", context: {} },
];

async function main() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error("MINIMAX_API_KEY not set in .env.local");
    process.exit(1);
  }
  for (const [i, s] of SAMPLES.entries()) {
    process.stdout.write(`[${i + 1}/${SAMPLES.length}] ${s.type} … `);
    try {
      const prompts = promptFor(s.type, s.context);
      const out = await generateChatterScript(prompts, { apiKey });
      const words = out.trim().split(/\s+/).length;
      console.log(`(${words} words)\n${out}\n`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
