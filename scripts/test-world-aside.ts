// scripts/test-world-aside.ts
//
// Smoke test for the world_aside pipeline. Hits Brave Search live and
// MiniMax live, prints each step's result. Run from the numaradio repo
// root:
//
//   # If BRAVE_API_KEY is in .env.local:
//   npx tsx scripts/test-world-aside.ts
//
//   # If it's only in /etc/numa/env (production-style):
//   BRAVE_API_KEY=$(sudo grep '^BRAVE_API_KEY=' /etc/numa/env | cut -d= -f2-) \
//     npx tsx scripts/test-world-aside.ts
//
// The script does NOT touch the live broadcast or write any rows. Pure
// network-call smoke test of fetchWorldAside().

import "../lib/load-env";
import { fetchWorldAside, pickTopic } from "../workers/queue-daemon/world-aside-client.ts";

function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function red(s: string): string { return `\x1b[31m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }

async function main() {
  console.log(bold("\nworld_aside smoke test"));
  console.log(dim("=".repeat(60)));

  const braveKey = process.env.BRAVE_API_KEY ?? "";
  const minimaxKey = process.env.MINIMAX_API_KEY ?? "";

  console.log(`\n${bold("Step 1:")} env check`);
  console.log(`  BRAVE_API_KEY:   ${braveKey ? green("present") : red("MISSING")} ${braveKey ? `(${braveKey.length} chars, ${braveKey.slice(0, 4)}…)` : ""}`);
  console.log(`  MINIMAX_API_KEY: ${minimaxKey ? green("present") : red("MISSING")} ${minimaxKey ? `(${minimaxKey.length} chars)` : ""}`);

  if (!braveKey || !minimaxKey) {
    console.log(red("\n  Missing key — bail."));
    console.log(dim("  Tip: BRAVE_API_KEY=$(sudo grep '^BRAVE_API_KEY=' /etc/numa/env | cut -d= -f2-) npx tsx scripts/test-world-aside.ts"));
    process.exit(1);
  }

  console.log(`\n${bold("Step 2:")} pickTopic (deterministic preview)`);
  const previewPicks = [pickTopic([], () => 0.0, new Date()), pickTopic([], () => 0.5, new Date()), pickTopic([], () => 0.99, new Date())];
  for (const p of previewPicks) {
    if (!p) continue;
    console.log(`  → ${p.category.padEnd(13)} | query="${p.query}"`);
  }

  console.log(`\n${bold("Step 3:")} fetchWorldAside (live Brave + live MiniMax)`);
  const t0 = Date.now();
  const result = await fetchWorldAside(
    { show: "Prime Hours", recentTopics: [] },
    { braveKey, minimaxKey },
  );
  const elapsed = Date.now() - t0;

  console.log(`  elapsed: ${elapsed}ms`);
  if (result.ok) {
    console.log(`  ${green("OK")}`);
    console.log(`  topic: ${result.topic}`);
    console.log(`  line:  "${result.line}"`);
    console.log(green("\n✓ Pipeline works end-to-end. World asides will work on air.\n"));
  } else {
    console.log(`  ${red("FAIL")}: reason=${result.reason}`);
    console.log(red("\n✗ Pipeline failed. Check the reason above.\n"));
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(red("\nUnexpected throw:"), err);
  process.exit(3);
});
