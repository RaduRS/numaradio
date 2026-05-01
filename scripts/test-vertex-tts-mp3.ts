import "../lib/load-env";
import { writeFileSync } from "node:fs";
import { synthesizeVertex } from "../workers/queue-daemon/vertex-tts.ts";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "numa-radio-dashboard-494716";
const TEXT =
  process.argv[2] ??
  "Hi, you're tuned in to Numa Radio. The station that never sleeps.";
const OUT = "/mnt/c/Users/marku/Desktop/numa-vertex-leda.mp3";

async function main() {
  console.log(`[mp3-smoke] project=${PROJECT}`);
  console.log(`[mp3-smoke] text=${JSON.stringify(TEXT)}`);
  const t0 = Date.now();
  const mp3 = await synthesizeVertex(TEXT, { project: PROJECT });
  const ms = Date.now() - t0;
  writeFileSync(OUT, mp3);
  console.log(`[mp3-smoke] wrote ${mp3.length} bytes → ${OUT} (${ms} ms)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
