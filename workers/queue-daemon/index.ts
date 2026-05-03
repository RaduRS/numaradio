import { createServer } from "node:http";
import { prisma } from "./prisma.ts";
import { SupervisedSocket } from "./socket.ts";
import { RingBuffer } from "./status-buffers.ts";
import { hydrate, type StagedItem } from "./hydrator.ts";
import { createHandler, type OnTrackBody, type PushBody, type StatusSnapshot } from "./server.ts";
import { resolveTrackId, type TrackLookup } from "./resolve-track.ts";
import { S3Client } from "@aws-sdk/client-s3";
import { AutoHostOrchestrator } from "./auto-host.ts";
import { AnnouncementOrchestrator } from "./announce.ts";
import {
  StationConfigCache,
  type AutoHostMode,
  type VoiceProvider,
} from "./station-config.ts";
import { fetchListenerCount } from "./icecast-listeners.ts";
import { fetchYoutubeAudience } from "./youtube-audience.ts";
import { generateChatterScript } from "./minimax-script.ts";
import { createSynthesizer } from "./synth-router.ts";
import { uploadChatterAudio } from "./chatter-upload.ts";
import { ContextLineOrchestrator, buildStationState } from "./context-line.ts";
import { fetchWorldAside } from "./world-aside-client.ts";
import { runRefresh as refreshRotation, writeManualRotation, clearManualRotation as clearManualRotationFile } from "../../scripts/refresh-rotation.ts";
import {
  createYoutubeChatLoop,
  DEFAULT_POLL_INTERVAL_MS as YT_CHAT_INTERVAL_MS,
  type YoutubeChatLoop,
} from "./youtube-chat-loop.ts";
import { recordYoutubeQuota } from "../../lib/youtube-quota.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const LS_HOST = process.env.NUMA_LS_HOST ?? "127.0.0.1";
const LS_PORT = Number(process.env.NUMA_LS_PORT ?? 1234);
const HTTP_PORT = Number(process.env.NUMA_DAEMON_PORT ?? 4000);
const ICECAST_STATUS_URL = process.env.ICECAST_STATUS_URL ?? "http://127.0.0.1:8000/status-json.xsl";
const ICECAST_MOUNT = process.env.ICECAST_MOUNT ?? "/stream";
// Loopback to the dashboard's YouTube health endpoint. CF Access auth
// only applies at the CF edge — never on loopback — so no credentials
// needed. The dashboard in-process caches the underlying YouTube API
// call for 30s, so this fetch is effectively free.
const DASHBOARD_YOUTUBE_HEALTH_URL =
  process.env.DASHBOARD_YOUTUBE_HEALTH_URL ??
  "http://127.0.0.1:3001/api/youtube/health";

const sock = new SupervisedSocket({ host: LS_HOST, port: LS_PORT });
const lastPushes = new RingBuffer<{ at: string; trackId: string; url: string; script?: string }>(10);
const lastFailures = new RingBuffer<{ at: string; reason: string; detail?: string }>(10);
// Surface the most recent hydrate failure so the dashboard /status
// view can show "queue staging stalled at <time>: <error>" rather
// than swallowing it in stderr. null = no failure since boot.
let lastHydrationError: { at: string; message: string } | null = null;

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

const stationConfig = new StationConfigCache({
  // 10 s instead of 30 s so an operator-side mode flip in the
  // dashboard reflects in the daemon within ~10 s. The cache still
  // absorbs the ~6×/min auto-host call rate without hammering Neon.
  ttlMs: 10_000,
  fetchOnce: async () => {
    const s = await prisma.station.findUniqueOrThrow({
      where: { slug: STATION_SLUG },
      select: {
        autoHostMode: true,
        autoHostForcedUntil: true,
        autoHostForcedBy: true,
        worldAsideMode: true,
        worldAsideForcedUntil: true,
        worldAsideForcedBy: true,
        youtubeChatPollMs: true,
        voiceProvider: true,
      },
    });
    return {
      autoHost: {
        mode: s.autoHostMode as AutoHostMode,
        forcedUntil: s.autoHostForcedUntil,
        forcedBy: s.autoHostForcedBy,
      },
      worldAside: {
        mode: s.worldAsideMode as AutoHostMode,
        forcedUntil: s.worldAsideForcedUntil,
        forcedBy: s.worldAsideForcedBy,
      },
      youtubeChatPollMs: s.youtubeChatPollMs,
      voiceProvider: s.voiceProvider as VoiceProvider,
    };
  },
});

const synthesize = createSynthesizer({
  getProvider: async () => (await stationConfig.read()).voiceProvider,
  deepgramKey: process.env.DEEPGRAM_API_KEY ?? "",
  vertexProject: process.env.GOOGLE_CLOUD_PROJECT ?? "",
});

const autoHost = new AutoHostOrchestrator({
  config: () => stationConfig.read(),
  getListenerCount: () =>
    fetchListenerCount({ url: ICECAST_STATUS_URL, mount: ICECAST_MOUNT }),
  getYoutubeAudience: () =>
    fetchYoutubeAudience({ url: DASHBOARD_YOUTUBE_HEALTH_URL }),
  revertExpired: async ({ block, fromMode, forcedUntil }) => {
    // Atomic UPDATE: only revert if forcedUntil hasn't moved (operator may
    // have just set a new forced state in the same window). updateMany
    // returns count=0 in that case; we invalidate the cache either way so
    // the next read picks up the authoritative state. `block` selects
    // which trio of columns we touch.
    try {
      if (block === "autoHost") {
        await prisma.station.updateMany({
          where: { slug: STATION_SLUG, autoHostForcedUntil: forcedUntil },
          data: {
            autoHostMode: "auto",
            autoHostForcedUntil: null,
            autoHostForcedBy: null,
          },
        });
      } else {
        await prisma.station.updateMany({
          where: { slug: STATION_SLUG, worldAsideForcedUntil: forcedUntil },
          data: {
            worldAsideMode: "auto",
            worldAsideForcedUntil: null,
            worldAsideForcedBy: null,
          },
        });
      }
      console.info(
        `action=${block}_auto_revert from=${fromMode} user=daemon reason=20m_elapsed`,
      );
    } catch (err) {
      console.warn(
        `[${block}] revertExpired failed:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      stationConfig.invalidate();
    }
  },
  resolveCurrentTrack: async () => {
    // Returns the currently-playing track. Used for BOTH:
    //   - back_announce context (Lena's speech bridges the current track's
    //     outro into the next, so she references the current track as "just
    //     ended" from the listener's POV by the time her sentence finishes).
    //   - push scheduling (startedAt + durationSeconds → compute when to
    //     push so Lena starts ~10s before the current track ends).
    const sid = await stationId();
    const np = await prisma.nowPlaying.findUnique({
      where: { stationId: sid },
      select: { currentTrackId: true, startedAt: true },
    });
    if (!np?.currentTrackId || !np.startedAt) return null;
    const t = await prisma.track.findUnique({
      where: { id: np.currentTrackId },
      select: { title: true, artistDisplay: true, durationSeconds: true },
    });
    if (!t) return null;
    return {
      title: t.title,
      artist: t.artistDisplay ?? "an artist",
      startedAtMs: np.startedAt.getTime(),
      durationSeconds: t.durationSeconds ?? null,
    };
  },
  generateScript: (prompts) =>
    generateChatterScript(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
  fetchWorldAside: (req) =>
    fetchWorldAside(req, {
      braveKey: process.env.BRAVE_API_KEY ?? "",
      minimaxKey: process.env.MINIMAX_API_KEY ?? "",
    }),
  synthesizeSpeech: synthesize,
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
  logPush: ({ chatterId, type, slot, url, script }) => {
    lastPushes.push({
      at: new Date().toISOString(),
      trackId: `auto-chatter:${chatterId}:${type}:slot${slot}`,
      url,
      script,
    });
    console.log(`[auto-chatter] slot=${slot} type=${type} id=${chatterId}`);
  },
  persistChatter: async ({ type, slot, url, script }) => {
    const sid = await stationId();
    await prisma.chatter.create({
      data: {
        stationId: sid,
        chatterType: type,
        slot,
        script,
        audioUrl: url,
      },
    });
  },
  logFailure: ({ reason, detail }) => {
    lastFailures.push({ at: new Date().toISOString(), reason, detail });
    console.warn(`[auto-chatter] fail ${reason}: ${detail ?? ""}`);
  },
});

// ─── Listener-song announcement wiring ───────────────────────────────
// Reuses the same MiniMax + Deepgram + B2 pipeline as auto-chatter.
// Event-driven: pushHandler schedules generation when a song-worker push
// includes an `announce` field, onTrackHandler pushes the stashed audio
// on that trackId's first-air.
const announce = new AnnouncementOrchestrator({
  generateScript: (prompts) =>
    generateChatterScript(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
  synthesizeSpeech: synthesize,
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
  logPush: ({ chatterId, trackId, url, script }) => {
    lastPushes.push({
      at: new Date().toISOString(),
      trackId: `announce:${trackId}:${chatterId}`,
      url,
      script,
    });
    console.log(`[announce] trackId=${trackId} chatterId=${chatterId}`);
  },
  logFailure: ({ reason, detail }) => {
    lastFailures.push({ at: new Date().toISOString(), reason, detail });
    console.warn(`[announce] fail ${reason}: ${detail ?? ""}`);
  },
  onVoicePushed: () => autoHost.onVoicePushed(),
});

async function stationId(): Promise<string> {
  const s = await prisma.station.findUniqueOrThrow({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  return s.id;
}

// ─── Tier 2 — context-aware Lena lines ───────────────────────────────
// Background tick every CONTEXT_LINE_TICK_MS. Reads real station state
// from Neon, asks MiniMax for one short truthful Lena line, validates,
// persists as Chatter row with chatterType="context_line" + audioUrl=null.
// Public lena-line route layers these between live audio chatter and
// the evergreen pool (see /api/station/lena-line/route.ts).
const CONTEXT_LINE_TICK_MS = 10 * 60_000;
const CONTEXT_LINE_FIRST_DELAY_MS = 30_000;

const contextLine = new ContextLineOrchestrator({
  fetchStationState: async () => {
    const sid = await stationId();
    return buildStationState({
      prisma,
      stationId: sid,
      now: new Date(),
    });
  },
  generateLine: (prompts) =>
    generateChatterScript(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
  persistLine: async (script) => {
    const sid = await stationId();
    await prisma.chatter.create({
      data: {
        stationId: sid,
        chatterType: "context_line",
        slot: 0,
        script,
        audioUrl: null,
      },
    });
  },
  logSuccess: (script) => {
    lastPushes.push({
      at: new Date().toISOString(),
      trackId: "context-line",
      url: "",
      script,
    });
    console.log(`[context-line] ${script.slice(0, 80)}`);
  },
  logFailure: (reason, detail) => {
    const prefixed = `context_line_${reason}`;
    lastFailures.push({ at: new Date().toISOString(), reason: prefixed, detail });
    console.warn(`[context-line] fail ${reason}: ${detail ?? ""}`);
  },
});

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

  // Listener-song announcement: pre-generate in the background so Lena can
  // intro the song over its first seconds when it airs. Only applies to
  // music pushes carrying explicit announce metadata (song-worker sets it
  // for fresh listener-generated tracks).
  if (kind === "music" && body.announce) {
    announce.schedule(body.trackId, body.announce);
  }

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

  // Push-based rotation refresh: regenerate playlist.m3u immediately on
  // every track-started so the just-started track is excluded before
  // Liquidsoap exhausts its in-memory shuffle and reshuffles. Without
  // this, the 2-min systemd timer leaves a window where Liquidsoap can
  // pick the same track at the boundary of two shuffle passes (1-in-pool
  // probability per cycle — bit listeners as back-to-back airings).
  // Race-guard inside runRefresh handles the case where this fires
  // before the Vercel track-started transaction has committed.
  refreshRotation(prisma).catch((err) =>
    console.error("[on-track] rotation refresh threw:", err),
  );

  // Music-track boundary → count it for auto-chatter (fires for both
  // rotation and priority-queue tracks). Fire-and-forget, non-blocking
  // so the existing priority-queue bookkeeping below isn't delayed.
  // Pass artist through so auto-host can track the recent-artists ring
  // used for "second X in a row" style DJ riffs. body.artist is optional;
  // the orchestrator ignores empty/undefined.
  const action = autoHost.onMusicTrackStart(body.artist);
  if (action === "trigger") {
    autoHost.runChatter().catch((err) =>
      console.error("[auto-chatter] runChatter threw:", err),
    );
  }

  // Listener-song announcement: if this track has a pre-generated intro
  // stashed (from a prior song-worker push with `announce` metadata),
  // push it to overlay_queue. Fire-and-forget — the announce module
  // awaits any still-in-progress generation internally. Also calls
  // autoHost.onVoicePushed() when it fires, so we don't stack voices.
  announce.announceIfPending(resolved.id);

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
    lastHydrationError,
    nextChatterSlot: autoHost.state.slotCounter % 20,
    pendingChatterOverride: autoHost.pendingOverride,
  };
}

function chatterOverrideHandler(body: { type: string }): { ok: true } {
  // Server already validated the string; cast is safe.
  autoHost.setPendingOverride(body.type as Parameters<typeof autoHost.setPendingOverride>[0]);
  console.info(`action=chatter_override type=${body.type}`);
  return { ok: true };
}

async function runHydrate(): Promise<void> {
  try {
    await hydrate({
      listStaged,
      resolveAssetUrl,
      markFailed,
      send: (line) => sock.send(line),
    });
    // Successful hydrate clears the prior error so the dashboard
    // doesn't keep flagging a stale outage after recovery.
    lastHydrationError = null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastHydrationError = { at: new Date().toISOString(), message };
    // Re-throw so the existing console.error path keeps logging.
    throw err;
  }
}

async function main() {
  // Start HTTP first so systemd can probe us while the socket connects.
  const server = createServer(
    createHandler({
      pushHandler,
      onTrackHandler,
      statusHandler,
      chatterOverrideHandler,
      refreshRotationHandler: () => refreshRotation(prisma),
      setManualRotationHandler: async (body) => {
        await writeManualRotation(body.trackIds);
        return refreshRotation(prisma);
      },
      clearManualRotationHandler: async () => {
        await clearManualRotationFile();
        return refreshRotation(prisma);
      },
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

  // Tier 2 context-line tick. First fire 30s after boot so the daemon
  // has time to connect; subsequent ticks every 10 min. catch() so a
  // single failure never bubbles into an unhandled rejection.
  const contextTick = () => contextLine.runOnce().catch(() => undefined);
  setTimeout(contextTick, CONTEXT_LINE_FIRST_DELAY_MS);
  setInterval(contextTick, CONTEXT_LINE_TICK_MS);

  // YouTube live chat → shoutout pipeline (PR 4). Inert when any of
  // the OAuth env vars are missing — letting an operator opt in by
  // adding the keys later without touching code.
  let ytChatLoop: YoutubeChatLoop | null = null;
  const ytClientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const ytClientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const ytRefreshToken = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
  // The internal endpoint lives on the Vercel app at numaradio.com.
  // api.numaradio.com is Icecast/Orion, not Vercel — pointing this at
  // the api subdomain returns Cloudflare's HTML 404 page.
  const ytShoutoutEndpoint =
    process.env.YOUTUBE_CHAT_SHOUTOUT_URL ??
    "https://numaradio.com/api/internal/youtube-chat-shoutout";
  const ytInternalSecret = process.env.INTERNAL_API_SECRET;
  if (ytClientId && ytClientSecret && ytRefreshToken && ytInternalSecret) {
    ytChatLoop = createYoutubeChatLoop({
      clientId: ytClientId,
      clientSecret: ytClientSecret,
      refreshToken: ytRefreshToken,
      shoutoutEndpoint: ytShoutoutEndpoint,
      internalSecret: ytInternalSecret,
      recordQuota: recordYoutubeQuota,
    });
    // Self-rescheduling tick reads the (cached) Station config each
    // time, so when an operator drops the slider in the dashboard
    // the new cadence picks up within ~10 s (next tick) without a
    // daemon restart. Hard floor of 15 s — anything tighter is a
    // quota footgun.
    const MIN_POLL_MS = 15_000;
    const MAX_POLL_MS = 600_000;
    const ytTick = async () => {
      try {
        const r = await ytChatLoop!.tick();
        if (r.dispatched > 0 || r.failed > 0) {
          console.log(
            `[yt-chat] tick: dispatched=${r.dispatched} held/skipped=${r.skippedRateLimit + r.skippedOwner + r.skippedLength} failed=${r.failed} liveChatId=${r.liveChatId ?? "none"}`,
          );
        }
      } catch (e) {
        console.error("[yt-chat] tick error", e);
      }
      const cfg = await stationConfig.read().catch(() => null);
      const nextDelay = Math.min(
        MAX_POLL_MS,
        Math.max(MIN_POLL_MS, cfg?.youtubeChatPollMs ?? YT_CHAT_INTERVAL_MS),
      );
      setTimeout(ytTick, nextDelay);
    };
    // First tick 30 s after boot so OAuth + Liquidsoap are warm.
    setTimeout(ytTick, 30_000);
    console.log("[queue-daemon] YouTube chat poller enabled (cadence read from Station.youtubeChatPollMs each tick)");
  } else {
    console.log(
      "[queue-daemon] YouTube chat poller DISABLED — set YOUTUBE_OAUTH_* env to enable",
    );
  }

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
