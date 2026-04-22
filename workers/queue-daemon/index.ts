import { createServer } from "node:http";
import { prisma } from "./prisma.ts";
import { SupervisedSocket } from "./socket.ts";
import { RingBuffer } from "./status-buffers.ts";
import { hydrate, type StagedItem } from "./hydrator.ts";
import { createHandler, type OnTrackBody, type PushBody, type StatusSnapshot } from "./server.ts";
import { resolveTrackId, type TrackLookup } from "./resolve-track.ts";
import { S3Client } from "@aws-sdk/client-s3";
import { AutoHostOrchestrator } from "./auto-host.ts";
import { StationFlagCache } from "./station-flag.ts";
import { generateChatterScript } from "./minimax-script.ts";
import { synthesizeChatter } from "./deepgram-tts.ts";
import { uploadChatterAudio } from "./chatter-upload.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const LS_HOST = process.env.NUMA_LS_HOST ?? "127.0.0.1";
const LS_PORT = Number(process.env.NUMA_LS_PORT ?? 1234);
const HTTP_PORT = Number(process.env.NUMA_DAEMON_PORT ?? 4000);

const sock = new SupervisedSocket({ host: LS_HOST, port: LS_PORT });
const lastPushes = new RingBuffer<{ at: string; trackId: string; url: string }>(10);
const lastFailures = new RingBuffer<{ at: string; reason: string; detail?: string }>(10);

// ─── Auto-chatter wiring ─────────────────────────────────────────
//
// IMPORTANT: all env reads here are LAZY. A missing MINIMAX_API_KEY /
// DEEPGRAM_API_KEY / B2_* var should NOT crash the daemon at boot —
// it should surface as a logged failure in lastFailures when the
// first chatter is attempted. The core queue-daemon behaviour
// (priority-pushes, shoutouts, on-track tracking) doesn't need any
// of these vars.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

let s3ChatterClientMemo: S3Client | undefined;
function getChatterS3Bits(): { s3: S3Client; bucket: string; publicBase: string } {
  if (!s3ChatterClientMemo) {
    s3ChatterClientMemo = new S3Client({
      region: requireEnv("B2_REGION"),
      endpoint: requireEnv("B2_ENDPOINT"),
      credentials: {
        accessKeyId: requireEnv("B2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("B2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return {
    s3: s3ChatterClientMemo,
    bucket: requireEnv("B2_BUCKET_NAME"),
    publicBase: requireEnv("B2_BUCKET_PUBLIC_URL"),
  };
}

const stationFlag = new StationFlagCache({
  ttlMs: 30_000,
  fetchOnce: async () => {
    const s = await prisma.station.findUniqueOrThrow({
      where: { slug: STATION_SLUG },
      select: { autoHostEnabled: true },
    });
    return s.autoHostEnabled;
  },
});

const autoHost = new AutoHostOrchestrator({
  flag: stationFlag,
  resolveJustEndedTrack: async () => {
    // Timing at a track boundary:
    //   1. Liquidsoap POSTs /api/internal/track-started to Vercel, which
    //      writes a PlayHistory row for the NEW (now-playing) track.
    //   2. Liquidsoap POSTs /on-track to us (this daemon), which fires
    //      onMusicTrackStart() and then this callback.
    // By the time this runs, PlayHistory[0] is the new track and
    // PlayHistory[1] is the one that just ended — which is what the
    // back_announce should reference ("That was X by Y").
    const sid = await stationId();
    const recent = await prisma.playHistory.findMany({
      where: { stationId: sid, trackId: { not: null } },
      orderBy: { startedAt: "desc" },
      take: 2,
      select: { trackId: true },
    });
    const justEndedTrackId = recent[1]?.trackId;
    if (!justEndedTrackId) return null;
    const t = await prisma.track.findUnique({
      where: { id: justEndedTrackId },
      select: { title: true, artistDisplay: true },
    });
    if (!t) return null;
    return { title: t.title, artist: t.artistDisplay ?? "an artist" };
  },
  generateScript: (prompts) =>
    generateChatterScript(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
  synthesizeSpeech: (text) =>
    synthesizeChatter(text, { apiKey: process.env.DEEPGRAM_API_KEY ?? "" }),
  uploadChatter: (body, id) => {
    const bits = getChatterS3Bits();
    return uploadChatterAudio(body, id, {
      bucket: bits.bucket,
      publicBaseUrl: bits.publicBase,
      s3: bits.s3,
    });
  },
  pushToOverlay: async (url) => {
    await sock.send(`overlay_queue.push ${url}`);
  },
  logPush: ({ chatterId, type, slot, url }) => {
    lastPushes.push({
      at: new Date().toISOString(),
      trackId: `auto-chatter:${chatterId}:${type}:slot${slot}`,
      url,
    });
    console.log(`[auto-chatter] slot=${slot} type=${type} id=${chatterId}`);
  },
  logFailure: ({ reason, detail }) => {
    lastFailures.push({ at: new Date().toISOString(), reason, detail });
    console.warn(`[auto-chatter] fail ${reason}: ${detail ?? ""}`);
  },
});

async function stationId(): Promise<string> {
  const s = await prisma.station.findUniqueOrThrow({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  return s.id;
}

async function resolveAssetUrl(trackId: string): Promise<string | null> {
  const asset = await prisma.trackAsset.findFirst({
    where: { trackId, assetType: "audio_stream" },
    select: { publicUrl: true },
  });
  return asset?.publicUrl ?? null;
}

async function listStaged(): Promise<StagedItem[]> {
  const sid = await stationId();
  const rows = await prisma.queueItem.findMany({
    where: {
      stationId: sid,
      priorityBand: "priority_request",
      queueStatus: { in: ["planned", "staged"] },
    },
    orderBy: { positionIndex: "asc" },
    select: { id: true, trackId: true, positionIndex: true, queueType: true },
  });
  return rows.map((r) => ({
    id: r.id,
    trackId: r.trackId,
    positionIndex: r.positionIndex,
    queueType: r.queueType === "shoutout" ? "shoutout" : "music",
  }));
}

async function markFailed(queueItemId: string, reasonCode: string): Promise<void> {
  await prisma.queueItem.update({
    where: { id: queueItemId },
    data: { queueStatus: "failed", reasonCode },
  });
  lastFailures.push({ at: new Date().toISOString(), reason: reasonCode, detail: queueItemId });
}

async function nextPositionIndex(sid: string): Promise<number> {
  const top = await prisma.queueItem.findFirst({
    where: { stationId: sid, priorityBand: "priority_request" },
    orderBy: { positionIndex: "desc" },
    select: { positionIndex: true },
  });
  return (top?.positionIndex ?? 0) + 1;
}

async function pushHandler(body: PushBody): Promise<{ queueItemId: string }> {
  const track = await prisma.track.findUnique({
    where: { id: body.trackId },
    select: { id: true, stationId: true },
  });
  if (!track) throw Object.assign(new Error("unknown track"), { statusCode: 400 });

  const kind = body.kind ?? "music";
  // Overlay voice goes to a dedicated Liquidsoap source
  // (`overlay_queue.push`) that's mixed on top of music via smooth_add.
  // Music goes through the classic priority queue that switches at track
  // boundary. See docs/superpowers/specs/2026-04-20-radio-feel-design.md.
  const telnetQueue = kind === "shoutout" ? "overlay_queue" : "priority";
  const queueType = kind === "shoutout" ? "shoutout" : "music";

  const position = await nextPositionIndex(track.stationId);
  const sourceObjectType = body.requestId ? "request" : "track";
  const sourceObjectId = body.requestId ?? body.trackId;

  // Shoutouts are fire-and-forget to the in-memory overlay_queue — they
  // don't need a "staged" phase. Mark completed at creation so the hydrator
  // never replays them on daemon reconnect.
  const initialStatus = kind === "shoutout" ? "completed" : "staged";

  const item = await prisma.queueItem.create({
    data: {
      stationId: track.stationId,
      queueType,
      sourceObjectType,
      sourceObjectId,
      trackId: body.trackId,
      priorityBand: "priority_request",
      queueStatus: initialStatus,
      positionIndex: position,
      insertedBy: "queue-daemon",
      reasonCode: body.reason,
    },
    select: { id: true },
  });

  // Fire-and-forget socket send. If offline, the row stays `staged` and the
  // hydrator re-sends on reconnect.
  lastPushes.push({ at: new Date().toISOString(), trackId: body.trackId, url: body.sourceUrl });
  sock
    .send(`${telnetQueue}.push ${body.sourceUrl}`)
    .catch((err) =>
      lastFailures.push({
        at: new Date().toISOString(),
        reason: "socket_send_failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
  // Any voice push (shoutout or our own chatter) resets the music counter.
  if (kind === "shoutout") autoHost.onVoicePushed();
  return { queueItemId: item.id };
}

async function onTrackHandler(body: OnTrackBody): Promise<void> {
  const sid = await stationId();
  const lookup: TrackLookup = {
    byId: async (id) =>
      prisma.track
        .findUnique({ where: { id }, select: { id: true, stationId: true } })
        .then((t) => (t && t.stationId === sid ? t : null)),
    byTitleArtist: async (title, artist) =>
      prisma.track
        .findFirst({
          where: {
            stationId: sid,
            title: { equals: title, mode: "insensitive" },
            ...(artist ? { artistDisplay: { equals: artist, mode: "insensitive" } } : {}),
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, stationId: true },
        })
        .then((t) => t ?? null),
  };
  const resolved = await resolveTrackId(body, lookup);
  if (!resolved) return;

  // Music-track boundary → count it for auto-chatter (fires for both
  // rotation and priority-queue tracks). Fire-and-forget, non-blocking
  // so the existing priority-queue bookkeeping below isn't delayed.
  const action = autoHost.onMusicTrackStart();
  if (action === "trigger") {
    autoHost.runChatter().catch((err) =>
      console.error("[auto-chatter] runChatter threw:", err),
    );
  }

  // Complete any prior playing priority item.
  await prisma.queueItem.updateMany({
    where: { stationId: sid, priorityBand: "priority_request", queueStatus: "playing" },
    data: { queueStatus: "completed" },
  });

  // Promote the oldest staged priority item for this track to playing.
  const staged = await prisma.queueItem.findFirst({
    where: {
      stationId: sid,
      priorityBand: "priority_request",
      queueStatus: "staged",
      trackId: resolved.id,
    },
    orderBy: { positionIndex: "asc" },
    select: { id: true, sourceObjectType: true, sourceObjectId: true },
  });
  if (!staged) return; // came from rotation, nothing to transition

  await prisma.queueItem.update({
    where: { id: staged.id },
    data: { queueStatus: "playing" },
  });
  if (staged.sourceObjectType === "request") {
    await prisma.request.update({
      where: { id: staged.sourceObjectId },
      data: { requestStatus: "aired" },
    });
  }
}

function statusHandler(): StatusSnapshot {
  return {
    socket: sock.isConnected() ? "connected" : "reconnecting",
    lastPushes: lastPushes.snapshot(),
    lastFailures: lastFailures.snapshot(),
  };
}

async function runHydrate(): Promise<void> {
  await hydrate({
    listStaged,
    resolveAssetUrl,
    markFailed,
    send: (line) => sock.send(line),
  });
}

async function main() {
  // Start HTTP first so systemd can probe us while the socket connects.
  const server = createServer(
    createHandler({
      pushHandler,
      onTrackHandler,
      statusHandler,
    }),
  );
  server.listen(HTTP_PORT, "127.0.0.1", () => {
    console.log(`[queue-daemon] http listening on 127.0.0.1:${HTTP_PORT}`);
  });

  // Hydrate on every (re)connect.
  sock.onReconnect(async () => {
    console.log("[queue-daemon] socket up — hydrating");
    await runHydrate().catch((err) => console.error("[queue-daemon] hydrate failed", err));
  });

  await sock.start();

  const shutdown = () => {
    console.log("[queue-daemon] shutting down");
    sock.stop();
    server.close();
    prisma.$disconnect().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[queue-daemon] fatal", err);
  process.exit(1);
});
