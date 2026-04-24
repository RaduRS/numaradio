# Lena Canonical Portrait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one canonical Lena portrait via OpenRouter Flux Pro and commit it to `~/saas/numaradio-videos/src/assets/lena/lena-v1.png` — the face the audience will attach to across every Phase 2 composition forever.

**Architecture:** A one-off TypeScript script in the videos repo hits OpenRouter's chat/completions API (same pattern as numaradio's song-worker) with `modalities: ["image"]` and a locked editorial-Vogue prompt, producing 8 candidate PNGs under `src/assets/lena/candidates/`. A human (the user) picks the keeper, agent renames it to `lena-v1.png`, cleans up, commits. No LenaPortrait primitive yet — that's Stage 2b.

**Tech Stack:** Node 24, TypeScript, `tsx`, `dotenv`, native `fetch`. Reuses OpenRouter credentials (`OPEN_ROUTER_API`) from numaradio's shared `.env.local`.

**Spec:** `docs/superpowers/specs/2026-04-24-lena-canonical-portrait-design.md`

---

## Task 1: Write the generator script + ignore candidates

**Files:**
- Create: `~/saas/numaradio-videos/src/scripts/generate-lena-portrait.ts`
- Modify: `~/saas/numaradio-videos/.gitignore` — append one line

No unit tests. The script is pure network + file I/O; the only meaningful verification is running it and looking at the candidates. Follows numaradio-videos' existing "tests cover pure functions only, not I/O scripts" convention (same pattern as `curate-music-beds.ts`).

- [ ] **Step 1: Append candidates folder to `.gitignore`**

From `/home/marku/saas/numaradio-videos/`:

```bash
cd /home/marku/saas/numaradio-videos
echo "src/assets/lena/candidates/" >> .gitignore
```

Verify the file's last line:

```bash
tail -1 .gitignore
```

Expected: `src/assets/lena/candidates/`

- [ ] **Step 2: Create `src/scripts/generate-lena-portrait.ts`**

Full contents:

```ts
#!/usr/bin/env -S node --experimental-strip-types

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.local"),
  quiet: true,
});

// Locked direction from brainstorming 2026-04-24:
// late-20s-to-30s editorial Vogue portrait, direct gaze, warm slight smirk,
// no props, dark backdrop with teal rim-light, medium-format film aesthetic.
const PROMPT = `Editorial photograph of a late-twenties woman, direct gaze into camera, warm slight smirk, confident and intimate mood. Cinematic moody lighting with a dark backdrop and subtle teal rim-light on hair and one shoulder. Medium-format film aesthetic, 85mm portrait lens, fine film grain, natural skin texture, soft shadow on one side of the face. Minimalist styling, no props, no jewelry, no logos, magazine-cover framing against a deep charcoal background with a whisper of teal atmosphere. Shallow depth of field, elevated warm confident mood.`;

const COUNT = 8;
const CONCURRENCY = 4;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "black-forest-labs/flux.2-pro";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      content?: string;
      images?: Array<{ image_url?: { url?: string } }>;
    };
  }>;
}

const DATA_URI_RE = /^data:image\/\w+;base64,(.+)$/;

function extractPngBase64(resp: OpenRouterImageResponse): string | null {
  // Same extraction logic as numaradio/workers/song-worker/openrouter.ts —
  // OpenRouter wraps image outputs in a choice.message.images array (data URI
  // or remote URL), with occasional fallbacks to raw base64 in content.
  const choice = resp.choices?.[0];
  const images = choice?.message?.images ?? [];
  for (const img of images) {
    const url = img.image_url?.url;
    if (!url) continue;
    const m = url.match(DATA_URI_RE);
    if (m) return m[1];
    if (url.startsWith("http")) return `__REMOTE__:${url}`;
  }
  const content = choice?.message?.content?.trim();
  if (content && /^[A-Za-z0-9+/=\n\r]+$/.test(content) && content.length > 200) {
    return content.replace(/\s+/g, "");
  }
  return null;
}

async function generateOne(): Promise<Buffer> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getEnv("OPEN_ROUTER_API")}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://numaradio.com",
      "X-Title": "Numa Radio — Lena portrait",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_IMAGE_MODEL ?? DEFAULT_MODEL,
      modalities: ["image"],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: PROMPT }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`openrouter ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as OpenRouterImageResponse;
  const extracted = extractPngBase64(data);
  if (!extracted) throw new Error("openrouter: no image in response");

  if (extracted.startsWith("__REMOTE__:")) {
    const url = extracted.slice("__REMOTE__:".length);
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`remote image fetch ${imgRes.status}`);
    return Buffer.from(await imgRes.arrayBuffer());
  }
  return Buffer.from(extracted, "base64");
}

async function main(): Promise<void> {
  getEnv("OPEN_ROUTER_API"); // fail fast if missing
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "../assets/lena/candidates");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`→ Generating ${COUNT} Lena portrait candidates via Flux Pro...`);
  console.log(`  prompt: ${PROMPT.slice(0, 90)}...`);
  console.log(`  model: ${process.env.OPENROUTER_IMAGE_MODEL ?? DEFAULT_MODEL}`);
  console.log(`  concurrency: ${CONCURRENCY}\n`);

  const failures: Array<{ index: number; error: string }> = [];

  // Concurrency via chunked Promise.all — simpler than a true pool, and for
  // an 8-image one-off the waste from slow stragglers is negligible.
  const indices = Array.from({ length: COUNT }, (_, i) => i + 1);
  for (let offset = 0; offset < indices.length; offset += CONCURRENCY) {
    const chunk = indices.slice(offset, offset + CONCURRENCY);
    await Promise.all(
      chunk.map(async (n) => {
        try {
          console.log(`  [${n}/${COUNT}] requesting...`);
          const buf = await generateOne();
          const path = resolve(outDir, `candidate-${n}.png`);
          writeFileSync(path, buf);
          console.log(`  ✓ [${n}/${COUNT}] ${path} (${(buf.length / 1024).toFixed(0)} KB)`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`  ✗ [${n}/${COUNT}] ${msg}`);
          failures.push({ index: n, error: msg });
        }
      }),
    );
  }

  const succeeded = COUNT - failures.length;
  console.log(`\n✓ ${succeeded} / ${COUNT} candidates saved to ${outDir}`);
  console.log(`\nNext: copy to Desktop and pick the winner:`);
  console.log(`  mkdir -p /mnt/c/Users/marku/Desktop/lena-candidates`);
  console.log(`  cp "${outDir}"/*.png /mnt/c/Users/marku/Desktop/lena-candidates/\n`);

  if (failures.length > 0) {
    console.error(`${failures.length} candidate(s) failed:`);
    for (const f of failures) console.error(`  #${f.index}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Type-check**

```bash
cd /home/marku/saas/numaradio-videos
npx tsc --noEmit
```

Expected: zero errors. If `dotenv`'s `config` throws a type error, the signature used here (`config({ path, quiet })`) matches the `curate-music-beds.ts` precedent — if it still errors, check that `dotenv` v17.x is installed (`npm ls dotenv`).

- [ ] **Step 4: Commit**

```bash
cd /home/marku/saas/numaradio-videos
git add .gitignore src/scripts/generate-lena-portrait.ts
git commit -m "scripts: lena portrait generator (flux pro, batch of 8)"
```

Verify:

```bash
git log --oneline -1
git status
```

Expected: one new commit on top, working tree clean.

---

## Task 2: Generate the candidate batch

**Files:**
- Side effect: creates `~/saas/numaradio-videos/src/assets/lena/candidates/candidate-1.png` through `candidate-8.png` (not committed — they're gitignored from Task 1).

- [ ] **Step 1: Run the generator**

```bash
cd /home/marku/saas/numaradio-videos
npx tsx src/scripts/generate-lena-portrait.ts
```

Expected output (timings will vary 30-90s total):

```
→ Generating 8 Lena portrait candidates via Flux Pro...
  prompt: Editorial photograph of a late-twenties woman, direct gaze into camera, warm slight smi...
  model: black-forest-labs/flux.2-pro
  concurrency: 4

  [1/8] requesting...
  [2/8] requesting...
  [3/8] requesting...
  [4/8] requesting...
  ✓ [1/8] /home/marku/saas/numaradio-videos/src/assets/lena/candidates/candidate-1.png (1234 KB)
  ✓ [4/8] ...
  ...
  ✓ [8/8] ...

✓ 8 / 8 candidates saved to /home/marku/saas/numaradio-videos/src/assets/lena/candidates
```

If any candidate fails (e.g. rate limit, bad response), the script continues with the rest and exits non-zero at the end. Partial batches are acceptable — as long as we got ≥ 5 successful images, the batch is worth reviewing.

- [ ] **Step 2: Verify the candidates**

```bash
ls -lh /home/marku/saas/numaradio-videos/src/assets/lena/candidates/
```

Expected: between 5-8 PNG files, each in the 500KB-2MB range (1024×1024 PNGs with photographic content).

- [ ] **Step 3: Copy candidates to Windows desktop for viewing**

```bash
mkdir -p /mnt/c/Users/marku/Desktop/lena-candidates
cp /home/marku/saas/numaradio-videos/src/assets/lena/candidates/*.png /mnt/c/Users/marku/Desktop/lena-candidates/
ls /mnt/c/Users/marku/Desktop/lena-candidates/
```

Expected: the same number of PNGs listed, now visible to the user on Windows.

- [ ] **Step 4: HUMAN REVIEW GATE**

The user opens `C:\Users\marku\Desktop\lena-candidates\` (File Explorer → double-click any PNG, arrow-key through the rest in the default photo viewer) and picks the winner.

Acceptable user responses:
- **"Candidate N"** (or "number N", or "pick 5") — proceed to Task 3 with that number.
- **"None of them work"** — iterate:
  - Edit `PROMPT` in `src/scripts/generate-lena-portrait.ts` based on user feedback (e.g. add "Mediterranean heritage", remove "smirk", specify hair length, etc.)
  - Delete the current candidates: `rm /home/marku/saas/numaradio-videos/src/assets/lena/candidates/*.png`
  - Commit the prompt change: `git add src/scripts/generate-lena-portrait.ts && git commit -m "scripts: tune lena portrait prompt — <reason>"`
  - Re-run Step 1 of this task
- **"Maybe N, but can we try with X change?"** — same iteration flow, but remember the tentative pick N in case the new batch is worse.

DO NOT pick a candidate on behalf of the user. This is their brand's face — human judgment is the only acceptable selector.

No commit in this task. The candidates stay uncommitted (they're gitignored).

---

## Task 3: Commit the keeper

**Files:**
- Create: `~/saas/numaradio-videos/src/assets/lena/lena-v1.png` (moved from the selected candidate)
- Side effect: `~/saas/numaradio-videos/src/assets/lena/candidates/` folder is deleted

Prerequisite: Task 2 complete and user has told us the winning candidate number.

- [ ] **Step 1: Move the selected candidate to the canonical path**

Replace `N` with the candidate number the user picked (e.g., `5`):

```bash
cd /home/marku/saas/numaradio-videos
mv src/assets/lena/candidates/candidate-N.png src/assets/lena/lena-v1.png
```

Verify:

```bash
ls -lh src/assets/lena/lena-v1.png
```

Expected: one file, 500KB-2MB, at the canonical path.

- [ ] **Step 2: Delete the candidates folder**

```bash
rm -rf /home/marku/saas/numaradio-videos/src/assets/lena/candidates
```

Verify it's gone:

```bash
ls /home/marku/saas/numaradio-videos/src/assets/lena/
```

Expected: only `lena-v1.png`. No `candidates/` directory.

- [ ] **Step 3: Stage and commit the keeper**

```bash
cd /home/marku/saas/numaradio-videos
git add src/assets/lena/lena-v1.png
git status
```

Expected `git status`:
- `new file: src/assets/lena/lena-v1.png`
- Nothing else staged; working tree otherwise clean.

If `git status` shows additional changes (especially anything under `candidates/`), something is off — investigate before committing.

- [ ] **Step 4: Commit**

```bash
git commit -m "lena: canonical portrait v1 (flux pro)"
```

Verify:

```bash
git log --oneline -1
git ls-files src/assets/lena/
```

Expected:
- Latest commit message: `lena: canonical portrait v1 (flux pro)`
- `git ls-files`: exactly one line — `src/assets/lena/lena-v1.png`

---

## Definition of Done

Stage 2a is complete when all of the following hold:

1. `src/scripts/generate-lena-portrait.ts` exists and was type-checked cleanly.
2. `.gitignore` includes `src/assets/lena/candidates/`.
3. `src/assets/lena/lena-v1.png` exists, is committed, and depicts Lena per the approved direction (user-verified).
4. `src/assets/lena/candidates/` does NOT exist on disk.
5. `git log --oneline` shows at minimum two new commits (script + keeper) — possibly more if the prompt was iterated.
6. `git status` is clean.
7. User has visually approved the keeper (the point of the human-review gate in Task 2).

When all seven hold, Stage 2a is shipped. Next brainstorm + plan is Stage 2b (voice pipeline + flagship shoutout composition), starting fresh in a new session.

---

## Explicit non-goals (reminders)

- **No `LenaPortrait.tsx` primitive.** Deferred to Stage 2b where it meets a real composition's needs. Do NOT create it here.
- **No auto-selection of the keeper.** Human eye required.
- **No candidate retention after pick.** Rerun is cheap (~$0.40-$1.20) if we ever want new options.
- **No CLI flags on the script.** Edit the PROMPT constant + rerun.
- **No updates to numaradio's HANDOFF.md in this plan.** That happens once Stage 2b also lands — Stage 2a alone isn't worth a handoff entry.
