# Lena canonical portrait — Stage 2a of marketing videos

**Status:** brainstormed 2026-04-24, awaiting implementation plan
**Owner:** new script in `~/saas/numaradio-videos/src/scripts/generate-lena-portrait.ts`
**Relates to:** Phase 2 of `docs/superpowers/specs/2026-04-24-marketing-videos-design.md`. Stage 2a is the first of three sub-stages (2a: portrait → 2b: voice + flagship composition → 2c: remaining launch pieces).

## Why

Phase 2 compositions (ShoutoutFlagship, SongRequestDemo, MeetLena, DayInNuma — planned for 2b and 2c) all use Lena's face. She's the character the audience attaches to. Before building any voice/texture/composition work, we generate one canonical portrait that every Phase 2 video references.

This is deliberately a **one-time forever asset**. The audience should see the same Lena in every short. Re-rolling per video breaks character continuity — the same reason we commit this image to git rather than regenerating it.

## What we're making

1. A script that hits OpenRouter's Flux Pro with an approved prompt and generates 8 portrait candidates.
2. One selected PNG committed as `~/saas/numaradio-videos/src/assets/lena/lena-v1.png`.

## The agreed portrait direction

Editorial Vogue-style portrait, late-twenties-to-early-thirties woman, direct gaze, **warm inviting slight smirk**, confident and intimate mood. Cinematic moody dark backdrop with subtle teal rim-light on hair and shoulder. Medium-format film aesthetic, 85mm portrait lens, fine film grain, natural skin texture. Minimalist styling, no props, no jewelry, no logos. Magazine-cover framing.

Ethnicity deliberately unspecified in the prompt — Flux defaults can be nudged on rerun if the first batch is too homogeneous (e.g. add "mixed heritage" or "Mediterranean" to the prompt).

## Architecture

### Script: `src/scripts/generate-lena-portrait.ts`

Reuses the OpenRouter integration pattern from `~/saas/numaradio/workers/song-worker/openrouter.ts`:

- Env: `OPEN_ROUTER_API` (required), `OPENROUTER_IMAGE_MODEL` (defaults to `black-forest-labs/flux.2-pro`).
- API: POST `https://openrouter.ai/api/v1/chat/completions` with `modalities: ["image"]` and the prompt as the user message content.
- Response: base64 data URI or remote URL (handle both, same as `extractPngBase64` in the existing code).
- Writes each PNG to `src/assets/lena/candidates/candidate-${i}.png` (1..8).
- Concurrency 4 via `Promise.all` chunked batches, so OpenRouter isn't hit with 8 parallel calls at once.
- Uses `dotenv` (already in devDependencies from P9) with `quiet: true` to load `.env.local`.
- Prints each candidate's absolute path as it completes, then a final line with the Windows-desktop copy command.

### Hardcoded constants

```ts
const PROMPT = `Editorial photograph of a late-twenties woman, direct gaze into camera, warm slight smirk, confident and intimate mood. Cinematic moody lighting with a dark backdrop and subtle teal rim-light on hair and one shoulder. Medium-format film aesthetic, 85mm portrait lens, fine film grain, natural skin texture, soft shadow on one side of the face. Minimalist styling, no props, no jewelry, no logos, magazine-cover framing against a deep charcoal background with a whisper of teal atmosphere. Shallow depth of field, elevated warm confident mood.`;
const COUNT = 8;
const CONCURRENCY = 4;
```

Editing the prompt + rerunning is the iteration mechanism. No CLI flags — keep it simple.

### Selection workflow

Human-in-the-loop. No automated picking.

1. `cd ~/saas/numaradio-videos && npx tsx src/scripts/generate-lena-portrait.ts`
2. `cp src/assets/lena/candidates/*.png /mnt/c/Users/marku/Desktop/lena-candidates/`
3. User opens the folder on Windows, picks the winner by number.
4. Agent renames `candidate-${N}.png` → `lena-v1.png`, moves into `src/assets/lena/`, deletes the `candidates/` folder.
5. Commit `src/assets/lena/lena-v1.png` with message `lena: canonical portrait v1 (flux pro)`.

If no winners emerge: edit `PROMPT` in the script and rerun. Candidates are overwritten on subsequent runs (same paths). Cost per rerun: ~$0.40-$1.20 depending on Flux 2 Pro pricing on OpenRouter. Negligible for a forever-asset.

### Versioning

If we ever generate a v2 (e.g. Kontext edit for a pose variant, or an entirely fresh generation after a brand refresh), it becomes `lena-v2.png`. `lena-v1.png` is never overwritten. Compositions explicitly reference `lena-v1.png` so they don't silently drift when a v2 lands.

## Repo changes

| Path | Change |
|---|---|
| `src/scripts/generate-lena-portrait.ts` | Create |
| `src/assets/lena/lena-v1.png` | Create (the keeper — human-selected from 8 candidates) |
| `.gitignore` | Append `src/assets/lena/candidates/` so unselected candidates never commit |

## Testing + error handling

**No unit tests.** Script is pure I/O with no testable pure logic. The verification is visual: either the 8 candidates yield a viable portrait or they don't.

**Error handling:**
| Failure | Behavior |
|---|---|
| Missing `OPEN_ROUTER_API` | Fail at startup with friendly error |
| OpenRouter 4xx/5xx on any individual candidate | Log the failed candidate's index + status, continue with remaining candidates. Exit non-zero at end if any failed. |
| No image in response body | Log which candidate, continue |
| Disk write failure | Fatal, exit non-zero |

The "continue on partial failure" pattern is intentional: if 6 of 8 candidates succeed, the user might still find a keeper in those 6 without rerunning.

## Non-goals (explicit)

- **No `LenaPortrait.tsx` primitive.** Deferred to Stage 2b where it'll be built against a real composition's needs (Ken Burns zoom, teal grade, etc.). Building it now is speculative — we don't know the exact interface compositions want.
- **No automated candidate scoring.** Human eye is the right tool.
- **No candidate retention after selection.** If we need more options later, rerun the script — it's cheap.
- **No support for custom prompts via CLI args.** Edit the script constant, rerun. Keeps the call site simple.
- **No Flux Kontext integration.** That's a Stage 2c+ concern if we ever need pose variants of the same Lena.
- **No backup of deleted candidates.** The keeper is committed; the rest are explicitly disposable.

## Ship sequence (for the plan skill to refine)

1. Write the script.
2. Update `.gitignore`.
3. Run the script, generate 8 candidates.
4. Copy candidates to Windows desktop.
5. User picks the keeper (manual step, outside the plan's execution).
6. Agent moves the keeper to `lena-v1.png`, cleans up candidates dir.
7. Commit `src/assets/lena/lena-v1.png` + `.gitignore` + `src/scripts/generate-lena-portrait.ts`.

If first batch is unsatisfactory, loop back to step 3 with a prompt edit.

---

Authored through the superpowers brainstorming skill. Implementation plan comes next via writing-plans.
