import "../../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";
import { claimNextJob } from "./claim.ts";
import { sweepStaleJobs } from "./sweeper.ts";
import { runPipeline } from "./pipeline.ts";

const POLL_INTERVAL_MS = 3_000;
const SWEEPER_INTERVAL_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  console.info("[song-worker] starting");

  try {
    const n = await sweepStaleJobs(prisma);
    if (n > 0) console.info(`[song-worker] sweeper reset ${n} stale rows at startup`);
  } catch (err) {
    console.warn(`[song-worker] sweeper failed at startup: ${String(err)}`);
  }
  setInterval(() => {
    sweepStaleJobs(prisma)
      .then((n) => {
        if (n > 0) console.info(`[song-worker] sweeper reset ${n} stale rows`);
      })
      .catch((err) => console.warn(`[song-worker] sweeper failed: ${String(err)}`));
  }, SWEEPER_INTERVAL_MS);

  let shutdown = false;
  const stop = (): void => {
    shutdown = true;
    console.info("[song-worker] shutdown requested");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!shutdown) {
    try {
      const job = await claimNextJob(prisma);
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      console.info(`[song-worker] processing ${job.id} (instrumental=${job.isInstrumental})`);
      try {
        await runPipeline(prisma, job);
        console.info(`[song-worker] done ${job.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[song-worker] pipeline failed ${job.id}: ${msg}`);
        try {
          await prisma.songRequest.delete({ where: { id: job.id } });
        } catch (dErr) {
          await prisma.songRequest.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: msg, completedAt: new Date() },
          });
          console.error(`[song-worker] delete failed ${job.id}: ${String(dErr)}`);
        }
      }
    } catch (err) {
      console.error(`[song-worker] loop error: ${String(err)}`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  await prisma.$disconnect();
  console.info("[song-worker] exited cleanly");
}

main().catch((err) => {
  console.error(`[song-worker] fatal: ${String(err)}`);
  process.exit(1);
});
