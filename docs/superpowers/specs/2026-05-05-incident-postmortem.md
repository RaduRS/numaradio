# 2026-05-05 — Live data wipe + cascading P1 incident

Two incidents back-to-back this afternoon. Documenting both so we can prevent recurrence.

## Timeline (UTC)

- **~13:30** — P0 audit ships (`fa186b5`) + Liquidsoap recursive-fn hotfix (`caf2ea0`). Operator follow-ups 1-4 run on Orion: queue-daemon, song-worker, liquidsoap, dashboard restarted. System verified healthy: `lastPushes` recorded at `13:32:49`.
- **~14:30** — P1 audit ships in three commits: `3b73f90` (timeouts + Prisma migration: `Shoutout.deliveryStatus String → DeliveryStatus enum` + 5 hot-path indexes), `4347381` (systemd hardening). Vercel auto-deploys. Operator does NOT yet run the P1 follow-ups (specifically: `npx prisma migrate deploy`).
- **~14:35** — Live website shoutouts/recent endpoint starts returning HTTP 500 silently. Public reads of NowPlaying / Track / etc still 200 with empty bodies.
- **Some time between 14:30 and 14:50** — All data tables wiped (Station, Track, NowPlaying, QueueItem, Shoutout, MusicSubmission, PlayHistory). Schema preserved. `_prisma_migrations` table also disappeared. SiteVisitor + YoutubeQuotaUsage retained 3 + 1 rows respectively.
- **~14:50** — Operator reports "all data is missing on the live website and on dashboard". Stream still up (Liquidsoap reads `/etc/numa/playlist.m3u` from disk; doesn't query DB live).
- **~15:00** — Diagnose via direct Prisma queries — confirm DB is empty.
- **~15:05** — Operator runs Neon point-in-time restore (twice). Data returns: 1 Station, 120 Tracks, 47 QueueItems, 39 Shoutouts, 41 Submissions, 5742 PlayHistory rows. `_prisma_migrations` table also restored.
- **~15:09** — Operator restarts queue-daemon. /status reports healthy.
- **~15:35** — Operator notices live site still missing shoutouts data. Probe of `/api/station/shoutouts/recent` returns HTTP 500 with empty body. Root cause: Vercel rebuilt the Prisma client against the new schema (`DeliveryStatus` enum), but the column on the DB is still `String` because the migration never ran. Every Shoutout query throws on type mismatch.
- **~15:40** — Revert (`e2a30e5`) lands: schema enum + migration removed. Vercel auto-deploys. All public read endpoints return real data again. Live site recovers.

## What broke

### Incident A — data wipe (root cause: UNKNOWN)

**Symptom:** every data table simultaneously emptied, schema preserved, `_prisma_migrations` table also dropped.

**Audit of suspects, all ruled out:**

- ❌ Our P1 migration (`20260505134919_p1_indexes_and_delivery_status_enum`): did NOT run on prod. `prisma migrate status` confirmed pending. The user's manual attempt errored on a missing `DATABASE_URL` env var.
- ❌ Vercel build: no `buildCommand` override, only `postinstall: prisma generate` runs (pure codegen, no DB writes).
- ❌ `vercel.json`: only configures the privacy-sweep cron — that path's `runSweep()` does scoped `deleteMany` against rows older than retention windows, never wholesale.
- ❌ Our application code: `grep` for `DELETE FROM`, `TRUNCATE`, `migrate reset`, `db push.*force` returned a single match — `dashboard/.../artwork/route.ts` deleting one TrackAsset by id. Not a candidate.
- ❌ `bash_history` recent entries: no destructive Prisma command, no `psql` invocation, no manual SQL.
- ❌ Neon dashboard click (operator self-reported: "I haven't clicked anything").

**Symptom-fit:** The state we observed (all rows empty, all tables present, `_prisma_migrations` missing) most closely matches what `prisma db push --accept-data-loss --force-reset` produces. We could not identify what or who ran it.

**Open questions for next time:**
1. Does Neon have an audit log we can check? (Neon Pro+ has "Audit logs" under project settings.)
2. Is there a third-party integration (Vercel ↔ Neon, Linear, etc) with DB-level write access?
3. Was a separate terminal session running with `--dangerously-skip-permissions` that took an action we don't have visibility into?

### Incident B — P1 schema mismatch (root cause: my mistake)

**My change in `3b73f90`:**
```diff
- deliveryStatus    String           @default("pending")
+ deliveryStatus    DeliveryStatus   @default(pending)
+ enum DeliveryStatus { pending, moderating, held, aired, failed, blocked }
```
Plus a migration file to convert the column on the DB.

**What I missed:**
- Vercel auto-deploys on push and rebuilds the Prisma client against `schema.prisma` on every build.
- `prisma migrate deploy` does NOT run on Vercel (no buildCommand override) — only `prisma generate`.
- Therefore, after the push, Vercel's runtime had the new Prisma client (expects enum) but the DB still had the old column type (String). Every Shoutout read or write threw on type validation.
- Locally, my pre-flight tests (`npm test`, `npm run build`) passed because they used the regenerated client against ITSELF — not against an unmigrated DB.

**Why I was wrong to ship it as one commit:** schema-changing migrations need a deploy ordering that the auto-deploy pipeline doesn't enforce. The DB migration MUST run before the new client reaches production, or the schema change must be backwards-compatible (additive only).

## What's deployed where (current state, post-revert)

| Surface | Code state | Notes |
|---|---|---|
| Public site (Vercel) | `e2a30e5` (revert) | All P0 fixes + P1 timeouts + P1 frontend hooks + P1 heartbeat rate-limit. NO schema enum (reverted). |
| `numa-queue-daemon` (Orion) | `e2a30e5` | Restarted 15:09 UTC. Has P0 (announce TTL, auto-host fix, atomic positionIndex) + P1 (minimax-script timeout, deepgram body cancel, classify fail-closed). |
| `numa-song-worker` (Orion) | P0 era code (`fa186b5`/`caf2ea0`) | Has B2 cleanup, sweeper 20-min, mark-failed-not-deleted. P1 didn't touch it. |
| `numa-liquidsoap` (Orion) | P0 era (`caf2ea0`) | Has the retry helper. P1 didn't touch it. |
| `numa-dashboard` (Orion) | P0 era code | Operator deployed it during P0 follow-ups but has NOT redeployed since. Running without P1 dashboard fixes (openrouter timeout, humanize timeout, SubmissionsPanel visibility gate). Pure P0 code. |
| Encoder shell (Windows OBS primary) | P0 (`fa186b5`) | Cold fallback only. Untouched by P1. |

## What's NOT in production right now

These P1 items are committed in repo but NOT yet running on the dashboard until operator re-deploys it:
- `dashboard/lib/openrouter.ts` — 45s + 15s fetch timeouts on artwork generation
- `dashboard/lib/humanize.ts` — 20s timeout on humanize MiniMax call
- `dashboard/app/library/SubmissionsPanel.tsx` — visibility-gated polling

Operator follow-up if they want these live: `cd dashboard && npm run deploy`.

## P1 schema migration: deferred

The `Shoutout.deliveryStatus` enum + 5 indexes are **not in the codebase any more**. Re-introducing them safely needs:

1. **Baseline `_prisma_migrations` table first.** Prod DB clearly hasn't been tracking via Prisma's migration system. Run `prisma migrate resolve --applied <each>` for each existing migration without running it, so the tracking table reflects reality.
2. **Schema change backwards-compatible.** Either:
   - Add new column `deliveryStatusV2 DeliveryStatus`, double-write from app code for one deploy, then read from v2 once data is backfilled.
   - Or pause traffic, run `prisma migrate deploy` while service is down, deploy new client.
3. **Indexes can ship independently** (additive, no app-code coupling).

## Lessons / process changes for next time

1. **Never ship a schema migration that requires the migration step to run on prod, in the same commit as the code that depends on it.** Either ship index-only migrations (additive), or coordinate a 2-step deploy (migration first, code after).
2. **Verify `_prisma_migrations` baseline exists before pushing any Prisma migration to prod.** A `prisma migrate status` showing "0 of N applied" against a populated DB means the tracking table is missing — fix that first, then ship.
3. **For unknown-cause data wipes: Neon point-in-time restore is the recovery path.** Free tier keeps 24h. Operator should know this is the first move, not some recovery script.
4. **Stop the rotation refresher timer during DB recovery** so it can't write an empty m3u from an empty DB and silence the stream:
   ```
   sudo systemctl stop numa-rotation-refresher.timer
   ```

## Config drift noticed (separate issue)

`INTERNAL_API_SECRET` differs between `/etc/numa/env` (used by Liquidsoap; matches Vercel and works) and `~/saas/numaradio/.env.local` (used by local scripts; gets 401 on Vercel). Worth aligning so future scripts don't get unexpected 401s. Not breaking anything live.
