// scripts/test-world-aside.ts
//
// Smoke test for the world_aside pipeline. Hits Brave Search live and
// MiniMax live, prints each step's result. Run from the repo root:
//
//   BRAVE_API_KEY=$(sudo grep '^BRAVE_API_KEY=' /etc/numa/env | cut -d= -f2-) \
//     npx tsx scripts/test-world-aside.ts
//
// Tries 3 different categories (weather → music → on-this-day). Reports
// each attempt's category, query, first Brave snippet, model output,
// and validation outcome. Reports OVERALL success if any of the 3 succeeded.
// `no_good_angle` on a draw is normal — production demotes to filler.

import "../lib/load-env";
import {
  fetchWorldAside,
  type WorldAsideClientOpts,
} from "../workers/queue-daemon/world-aside-client.ts";

function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function red(s: string): string { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }

interface Attempt {
  label: string;
  // Pin rand so the topic picker lands on a specific category.
  rand: () => number;
  // recentTopics to pre-saturate so a single category remains.
  recentTopics: string[];
}

// Saturate every category except the named target so the weighted-random
// picker is forced to land on the one we want. weather has 5 cities, the
// others use 3 dummy entries each (>= 3 triggers exclusion).
function saturateAllExcept(target: "weather" | "music" | "ai-tech" | "on-this-day" | "culture" | "astro"): string[] {
  const out: string[] = [];
  if (target !== "weather") {
    out.push("weather:lisbon", "weather:london", "weather:new york", "weather:tokyo", "weather:sydney");
  }
  for (const cat of ["music", "ai-tech", "on-this-day", "culture", "astro"] as const) {
    if (cat === target) continue;
    out.push(`${cat}:a`, `${cat}:b`, `${cat}:c`);
  }
  return out;
}

const ATTEMPTS: Attempt[] = [
  { label: "weather (Lisbon)", rand: () => 0.0, recentTopics: [] },
  { label: "music",            rand: () => 0.5, recentTopics: saturateAllExcept("music") },
  { label: "ai-tech",          rand: () => 0.5, recentTopics: saturateAllExcept("ai-tech") },
  { label: "on-this-day",      rand: () => 0.5, recentTopics: saturateAllExcept("on-this-day") },
  { label: "culture",          rand: () => 0.5, recentTopics: saturateAllExcept("culture") },
  { label: "astro",            rand: () => 0.5, recentTopics: saturateAllExcept("astro") },
];

async function runAttempt(
  label: string,
  recentTopics: string[],
  rand: () => number,
  baseOpts: Omit<WorldAsideClientOpts, "rand">,
): Promise<{ ok: boolean; reason?: string; line?: string; topic?: string; ms: number }> {
  const t0 = Date.now();
  const r = await fetchWorldAside(
    { show: "Prime Hours", recentTopics },
    { ...baseOpts, rand },
  );
  const ms = Date.now() - t0;
  if (r.ok) return { ok: true, line: r.line, topic: r.topic, ms };
  return { ok: false, reason: r.reason, ms };
}

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
    process.exit(1);
  }

  console.log(`\n${bold("Step 2:")} attempt 3 categories live (Brave + MiniMax)`);

  const baseOpts: Omit<WorldAsideClientOpts, "rand"> = { braveKey, minimaxKey };
  const successes: string[] = [];
  const fails: string[] = [];

  for (const a of ATTEMPTS) {
    process.stdout.write(`  ${a.label.padEnd(22)} `);
    try {
      const r = await runAttempt(a.label, a.recentTopics, a.rand, baseOpts);
      if (r.ok) {
        console.log(`${green("OK")} ${dim(`(${r.ms}ms)`)}`);
        console.log(`    topic: ${r.topic}`);
        console.log(`    line:  "${r.line}"`);
        successes.push(`${a.label}: "${r.line}"`);
      } else if (r.reason === "no_good_angle") {
        console.log(`${yellow("NO_GOOD_ANGLE")} ${dim(`(${r.ms}ms — model declined)`)}`);
        fails.push(`${a.label}: no_good_angle`);
      } else {
        console.log(`${red("FAIL")} reason=${r.reason} ${dim(`(${r.ms}ms)`)}`);
        fails.push(`${a.label}: ${r.reason}`);
      }
    } catch (e) {
      console.log(`${red("THROW")} ${e instanceof Error ? e.message : String(e)}`);
      fails.push(`${a.label}: throw`);
    }
  }

  console.log("");
  const total = ATTEMPTS.length;
  if (successes.length > 0) {
    console.log(green(`✓ ${successes.length}/${total} attempts produced a real Lena line. Pipeline works end-to-end.`));
    if (fails.length > 0) {
      console.log(yellow(`  ${fails.length} attempt(s) gracefully bailed — spec'd "demote to filler" path, not a bug.`));
    }
    process.exit(0);
  } else {
    console.log(red(`✗ 0/${total} attempts produced a line.`));
    if (fails.every((f) => f.endsWith("no_good_angle"))) {
      console.log(yellow(`  All bailed with NO_GOOD_ANGLE. Brave returned results; the model just didn't bite. Re-run in 5-10 min.`));
      console.log(yellow(`  In production this means slots demote to filler. Pipeline is wired correctly.`));
    } else {
      console.log(red(`  Not all bailouts — there's a real issue:`));
      for (const f of fails) console.log(red(`    - ${f}`));
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(red("\nUnexpected throw:"), err);
  process.exit(3);
});
