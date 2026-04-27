// Submission housekeeping — find + clean orphans on both sides.
//
// Two directions:
//
//   DB → B2: rows in 'pending' state with empty audioStorageKey are
//            orphans from a failed mid-upload (pre C2 fix). Old
//            (>1h) ones get deleted; pending without a file is
//            useless.
//
//   B2 → DB: any object under submissions/ whose id-prefix doesn't
//            match a MusicSubmission row (any status) is orphan
//            storage we missed deleting on a prior reject/approve/
//            withdraw flow.
//
//   DB → Track: 'approved' rows whose trackId no longer exists in
//               the Track table — operator manually deleted from the
//               library. Mark these as 'withdrawn' so they show up
//               in the audit trail honestly.
//
// Dry-run by default. Pass --apply to commit.

import "../lib/load-env.ts";
import { prisma } from "../lib/db";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3, bucket, deleteObject } from "../lib/storage";

const apply = process.argv.includes("--apply");
const PENDING_ORPHAN_AGE_MS = 60 * 60 * 1000; // 1 hour

async function listSubmissionsB2(): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = [];
  let continuationToken: string | undefined;
  do {
    const r = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: "submissions/",
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const obj of r.Contents ?? []) {
      if (obj.Key) out.push({ key: obj.Key, size: obj.Size ?? 0 });
    }
    continuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (continuationToken);
  return out;
}

function idFromKey(key: string): string | null {
  // submissions/<id>.<ext>
  const m = key.match(/^submissions\/([^./]+)\.[^/]+$/);
  return m?.[1] ?? null;
}

async function main() {
  console.log("═══ Submission cleanup ═══");
  console.log(`Mode: ${apply ? "APPLY" : "dry-run (pass --apply to commit)"}\n`);

  // ── DB orphans (pending without a real file) ──────────────────
  const pendingCutoff = new Date(Date.now() - PENDING_ORPHAN_AGE_MS);
  const orphanPending = await prisma.musicSubmission.findMany({
    where: {
      status: "pending",
      audioStorageKey: "",
      createdAt: { lt: pendingCutoff },
    },
    select: { id: true, email: true, createdAt: true },
  });
  console.log(`DB orphans (pending + empty audioStorageKey > 1h): ${orphanPending.length}`);
  for (const r of orphanPending) {
    console.log(`  ${r.id} · ${r.email} · ${r.createdAt.toISOString()}`);
  }

  // ── DB orphans (approved but Track gone) ─────────────────────
  const approved = await prisma.musicSubmission.findMany({
    where: { status: "approved", trackId: { not: null } },
    select: { id: true, trackId: true, email: true, artistName: true },
  });
  const trackIdsToCheck = approved.map((r) => r.trackId!).filter(Boolean);
  const existingTracks = trackIdsToCheck.length
    ? await prisma.track.findMany({
        where: { id: { in: trackIdsToCheck } },
        select: { id: true },
      })
    : [];
  const existingTrackIds = new Set(existingTracks.map((t) => t.id));
  const orphanApproved = approved.filter((r) => r.trackId && !existingTrackIds.has(r.trackId));
  console.log(`\nDB orphans (approved row + Track row missing): ${orphanApproved.length}`);
  for (const r of orphanApproved) {
    console.log(`  ${r.id} · ${r.email} · "${r.artistName}" · trackId=${r.trackId} (gone)`);
  }

  // ── B2 orphans (file with no DB row) ──────────────────────────
  console.log("\nListing B2 submissions/ prefix…");
  const b2Files = await listSubmissionsB2();
  console.log(`B2 files under submissions/: ${b2Files.length}`);
  if (b2Files.length === 0) {
    console.log("  (clean)");
  }

  const b2Ids = new Set(b2Files.map((f) => idFromKey(f.key)).filter((x): x is string => Boolean(x)));
  const dbIds = new Set(
    (await prisma.musicSubmission.findMany({ select: { id: true } })).map((r) => r.id),
  );
  const orphanB2 = b2Files.filter((f) => {
    const id = idFromKey(f.key);
    return id && !dbIds.has(id);
  });
  console.log(`B2 orphans (file without DB row): ${orphanB2.length}`);
  for (const f of orphanB2) {
    console.log(`  ${f.key} · ${(f.size / 1024).toFixed(1)} KB`);
  }

  // ── Bonus check: B2 files whose row is rejected/withdrawn ────
  // These should have been deleted at reject/withdraw time. If any
  // exist, surface them as a leak so we can fix the route logic.
  const dbStateMap = new Map<string, string>();
  const allRows = await prisma.musicSubmission.findMany({ select: { id: true, status: true } });
  for (const r of allRows) dbStateMap.set(r.id, r.status);
  const leaked = b2Files.filter((f) => {
    const id = idFromKey(f.key);
    if (!id) return false;
    const state = dbStateMap.get(id);
    return state === "rejected" || state === "withdrawn";
  });
  console.log(`B2 leaks (file persists for rejected/withdrawn row): ${leaked.length}`);
  for (const f of leaked) {
    const id = idFromKey(f.key);
    console.log(`  ${f.key} · row=${id} · state=${dbStateMap.get(id ?? "")}`);
  }

  if (!apply) {
    console.log("\n(dry run — pass --apply to commit deletes)");
    await prisma.$disconnect();
    return;
  }

  let dbDeleted = 0;
  let b2Deleted = 0;
  let withdrawnMarked = 0;

  // Delete pending-no-file orphans
  for (const r of orphanPending) {
    await prisma.musicSubmission.delete({ where: { id: r.id } });
    dbDeleted++;
  }

  // Mark approved-no-track orphans as withdrawn
  for (const r of orphanApproved) {
    await prisma.musicSubmission.update({
      where: { id: r.id },
      data: {
        status: "withdrawn",
        withdrawnAt: new Date(),
        withdrawnReason: "track row no longer in catalog (cleanup sweep)",
      },
    });
    withdrawnMarked++;
  }

  // Delete B2 orphans (no row)
  for (const f of orphanB2) {
    await deleteObject(f.key).catch(() => undefined);
    b2Deleted++;
  }

  // Delete leaked B2 files for rejected/withdrawn rows
  for (const f of leaked) {
    await deleteObject(f.key).catch(() => undefined);
    b2Deleted++;
  }

  console.log(
    `\nCleaned: db_rows_deleted=${dbDeleted}, db_rows_marked_withdrawn=${withdrawnMarked}, b2_files_deleted=${b2Deleted}`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
