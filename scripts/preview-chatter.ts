#!/usr/bin/env -S node --experimental-strip-types

// Dev tool — generates 8 sample chatter scripts via real MiniMax calls
// to preview prompt/temperature changes. Burns ~8 MiniMax credits per
// run, so it gates behind a y/N prompt unless invoked with --yes.

import "../lib/load-env.ts";
import { createInterface } from "node:readline/promises";
import { promptFor, type ChatterType } from "../workers/queue-daemon/chatter-prompts.ts";
import { generateChatterScript } from "../workers/queue-daemon/minimax-script.ts";
import { showForHour, timeOfDayFor, formatLocalTime } from "../lib/schedule.ts";

const SKIP_CONFIRM = process.argv.includes("--yes") || process.argv.includes("-y");

interface Sample {
  type: ChatterType;
  context: Parameters<typeof promptFor>[1];
}

const NOW = new Date();
const HOUR = NOW.getHours();
const SHOW = showForHour(HOUR).name;
const LOCAL_TIME = formatLocalTime(NOW);
const TIME_OF_DAY = timeOfDayFor(HOUR);

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
      localTime: LOCAL_TIME,
      timeOfDay: TIME_OF_DAY,
    },
  },
  {
    type: "back_announce",
    context: {
      title: "Ocean Eyes",
      artist: "Russell Ross",
      localTime: LOCAL_TIME,
      timeOfDay: TIME_OF_DAY,
    },
  },
  // 2× shoutout_cta
  {
    type: "shoutout_cta",
    context: {
      currentShow: SHOW,
      slotsSinceOpening: 9,
      localTime: LOCAL_TIME,
      timeOfDay: TIME_OF_DAY,
    },
  },
  { type: "shoutout_cta", context: { localTime: LOCAL_TIME, timeOfDay: TIME_OF_DAY } },
  // 2× song_cta
  {
    type: "song_cta",
    context: {
      currentShow: SHOW,
      slotsSinceOpening: 11,
      localTime: LOCAL_TIME,
      timeOfDay: TIME_OF_DAY,
    },
  },
  { type: "song_cta", context: { localTime: LOCAL_TIME, timeOfDay: TIME_OF_DAY } },
  // 2× filler
  {
    type: "filler",
    context: { currentShow: SHOW, localTime: LOCAL_TIME, timeOfDay: TIME_OF_DAY },
  },
  { type: "filler", context: { localTime: LOCAL_TIME, timeOfDay: TIME_OF_DAY } },
];

async function confirmRun(): Promise<boolean> {
  if (SKIP_CONFIRM) return true;
  if (!process.stdin.isTTY) {
    console.error(
      "preview-chatter: stdin is not a TTY and --yes was not passed. " +
        "Refusing to silently burn ~8 MiniMax credits.",
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "This will spend ~8 MiniMax credits to generate sample chatter. Continue? [y/N] ",
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error("MINIMAX_API_KEY not set in .env.local");
    process.exit(1);
  }
  if (!(await confirmRun())) {
    console.error("Aborted.");
    process.exit(0);
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
