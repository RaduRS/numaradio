// Privacy retention sweep — single source of truth for what gets
// deleted and when. Runs from two places:
//
//   1. scripts/privacy-sweep.ts     — manual / dry-run from the CLI
//   2. app/api/cron/privacy-sweep   — daily Vercel cron at 04:00 UTC
//
// Retention windows MUST match what app/privacy/page.tsx promises:
//   - Shoutouts that didn't air        → 90 days
//   - Song requests with no track      → 90 days
//   - Rejected music submissions       → 30 days
//
// Aired shoutouts, approved submissions, and withdrawn rows are NOT
// touched here — they have their own lifecycles.

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const SHOUTOUT_UNAIRED_DAYS = 90;
export const SONGREQUEST_DAYS = 90;
export const REJECTED_SUBMISSION_DAYS = 30;

export interface SweepCounts {
  shoutoutsDeleted: number;
  songRequestsDeleted: number;
  rejectedSubmissionsDeleted: number;
}

export interface SweepPreview {
  shoutoutsToDelete: number;
  songRequestsToDelete: number;
  rejectedSubmissionsToDelete: number;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function shoutoutWhere() {
  return {
    createdAt: { lt: daysAgo(SHOUTOUT_UNAIRED_DAYS) },
    OR: [
      { deliveryStatus: { not: "aired" } },
      { moderationStatus: { in: ["blocked" as const, "held" as const] } },
    ],
  };
}

function songRequestWhere() {
  return {
    createdAt: { lt: daysAgo(SONGREQUEST_DAYS) },
    AND: [
      { trackId: null },
      { status: { notIn: ["played", "queued", "generating"] } },
    ],
  };
}

function submissionWhere() {
  return {
    status: "rejected" as const,
    reviewedAt: { lt: daysAgo(REJECTED_SUBMISSION_DAYS) },
  };
}

/** Read-only count of rows that would be deleted right now. */
export async function previewSweep(): Promise<SweepPreview> {
  const [shoutoutsToDelete, songRequestsToDelete, rejectedSubmissionsToDelete] =
    await Promise.all([
      prisma.shoutout.count({ where: shoutoutWhere() }),
      prisma.songRequest.count({ where: songRequestWhere() }),
      prisma.musicSubmission.count({ where: submissionWhere() }),
    ]);
  return { shoutoutsToDelete, songRequestsToDelete, rejectedSubmissionsToDelete };
}

/** Run the sweep + write an audit row to SystemEvent. */
export async function runSweep(): Promise<SweepCounts> {
  const [r1, r2, r3] = await Promise.all([
    prisma.shoutout.deleteMany({ where: shoutoutWhere() }),
    prisma.songRequest.deleteMany({ where: songRequestWhere() }),
    prisma.musicSubmission.deleteMany({ where: submissionWhere() }),
  ]);
  const counts: SweepCounts = {
    shoutoutsDeleted: r1.count,
    songRequestsDeleted: r2.count,
    rejectedSubmissionsDeleted: r3.count,
  };

  // Audit row — used by the dashboard to render "last sweep" status.
  // Prisma's JSON input type requires an index signature; SweepCounts
  // is a closed interface, so cast to InputJsonObject. Values are all
  // primitive numbers — guaranteed JSON-safe.
  await prisma.systemEvent.create({
    data: {
      eventType: "privacy_sweep",
      sourceType: "cron",
      sourceId: "privacy-sweep",
      payloadJson: counts as unknown as Prisma.InputJsonObject,
      processedAt: new Date(),
    },
  });

  return counts;
}

/** Read the last sweep audit entry for dashboard display. */
export async function lastSweep(): Promise<{
  at: Date;
  counts: SweepCounts;
} | null> {
  const row = await prisma.systemEvent.findFirst({
    where: { eventType: "privacy_sweep" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, payloadJson: true },
  });
  if (!row) return null;
  const counts = (row.payloadJson as unknown as SweepCounts) ?? {
    shoutoutsDeleted: 0,
    songRequestsDeleted: 0,
    rejectedSubmissionsDeleted: 0,
  };
  return { at: row.createdAt, counts };
}
