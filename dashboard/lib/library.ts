import type { Pool } from "pg";

export interface LibraryTrack {
  id: string;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  bpm: number | null;
  genre: string | null;
  mood: string | null;
  show: string | null;
  trackStatus: string;
  airingPolicy: string;
  /**
   * Maps to Track.sourceType. Used client-side to hide shoutouts
   * (sourceType='external_import') from the default library view
   * since they're voice overlays, not music.
   */
  sourceType: string;
  createdAt: string;
  audioStreamUrl: string | null;
  artworkUrl: string | null;
  /**
   * Origin of the cover art when the track came from an artist
   * submission: "upload" (artist uploaded a file), "id3" (embedded
   * in the MP3), "fallback" (per-show brand PNG), or null (no
   * MusicSubmission row, e.g. internal Suno/MiniMax tracks). The
   * dashboard uses this to disable the regenerate-artwork button
   * for "upload" / "id3" so an operator can't accidentally wipe
   * art the artist provided.
   */
  artworkSource: string | null;
  votesUp: number;
  votesDown: number;
}

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

const LIBRARY_TRACKS_SQL = `
  SELECT
    t.id,
    t.title,
    t."artistDisplay" AS artist,
    t."durationSeconds",
    t.bpm,
    t.genre,
    t.mood,
    t.show,
    t."trackStatus",
    t."airingPolicy",
    t."sourceType"    AS source_type,
    t."createdAt",
    audio."publicUrl" AS audio_stream_url,
    art."publicUrl"   AS artwork_url,
    sub."artworkSource" AS artwork_source,
    COALESCE(v.up, 0)   AS votes_up,
    COALESCE(v.down, 0) AS votes_down
  FROM "Track" t
  JOIN "Station" s ON s.id = t."stationId"
  LEFT JOIN LATERAL (
    SELECT "publicUrl"
    FROM "TrackAsset"
    WHERE "trackId" = t.id AND "assetType" = 'audio_stream'
    ORDER BY "createdAt" DESC
    LIMIT 1
  ) audio ON true
  LEFT JOIN LATERAL (
    SELECT "publicUrl"
    FROM "TrackAsset"
    WHERE "trackId" = t.id AND "assetType" = 'artwork_primary'
    ORDER BY "createdAt" DESC
    LIMIT 1
  ) art ON true
  LEFT JOIN LATERAL (
    SELECT "artworkSource"
    FROM "MusicSubmission"
    WHERE "trackId" = t.id
    LIMIT 1
  ) sub ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE value = 1)  AS up,
      COUNT(*) FILTER (WHERE value = -1) AS down
    FROM "TrackVote"
    WHERE "trackId" = t.id
  ) v ON true
  WHERE s.slug = $1
    -- 'library' = in rotation, 'request_only' = played once via priority
    -- (typically a listener-generated song) and now awaits manual re-push.
    -- Both should be browsable + pushable from the dashboard; 'hold' and
    -- 'priority_request' (pre-first-air) intentionally stay hidden.
    AND t."airingPolicy" IN ('library', 'request_only')
  ORDER BY t."createdAt" DESC
  LIMIT 1000
`;

interface RawRow {
  id: string;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  bpm: number | null;
  genre: string | null;
  mood: string | null;
  show: string | null;
  trackStatus: string;
  airingPolicy: string;
  source_type: string | null;
  createdAt: Date;
  audio_stream_url: string | null;
  artwork_url: string | null;
  artwork_source: string | null;
  votes_up: string | number;
  votes_down: string | number;
}

export async function fetchLibraryTracks(pool: Pool): Promise<LibraryTrack[]> {
  const result = await pool.query<RawRow>(LIBRARY_TRACKS_SQL, [STATION_SLUG]);
  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    durationSeconds: r.durationSeconds,
    bpm: r.bpm,
    genre: r.genre,
    mood: r.mood,
    show: r.show,
    trackStatus: r.trackStatus,
    airingPolicy: r.airingPolicy,
    sourceType: r.source_type ?? "unknown",
    createdAt: r.createdAt.toISOString(),
    audioStreamUrl: r.audio_stream_url,
    artworkUrl: r.artwork_url,
    artworkSource: r.artwork_source,
    // pg returns bigints as strings; coerce explicitly.
    votesUp: typeof r.votes_up === "string" ? parseInt(r.votes_up, 10) : r.votes_up,
    votesDown:
      typeof r.votes_down === "string" ? parseInt(r.votes_down, 10) : r.votes_down,
  }));
}

const RESOLVE_PUSH_SQL = `
  SELECT
    t.id,
    t.title,
    t."airingPolicy",
    audio."publicUrl" AS audio_stream_url
  FROM "Track" t
  JOIN "Station" s ON s.id = t."stationId"
  LEFT JOIN LATERAL (
    SELECT "publicUrl"
    FROM "TrackAsset"
    WHERE "trackId" = t.id AND "assetType" = 'audio_stream'
    ORDER BY "createdAt" DESC
    LIMIT 1
  ) audio ON true
  WHERE t.id = $1 AND s.slug = $2
  LIMIT 1
`;

export interface ResolvedPushTarget {
  id: string;
  title: string;
  airingPolicy: string;
  audioStreamUrl: string | null;
}

export async function resolvePushTarget(
  trackId: string,
  pool: Pool,
): Promise<ResolvedPushTarget | null> {
  const result = await pool.query<{
    id: string;
    title: string;
    airingPolicy: string;
    audio_stream_url: string | null;
  }>(RESOLVE_PUSH_SQL, [trackId, STATION_SLUG]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    airingPolicy: row.airingPolicy,
    audioStreamUrl: row.audio_stream_url,
  };
}

export interface DaemonStatus {
  socket?: string;
  lastPushes: unknown[];
  lastFailures: unknown[];
  /** Auto-chatter rotation pointer (0..19). Index of the slot the next
   *  chatter break will use. Undefined when the daemon is unreachable
   *  or running an older build. */
  nextChatterSlot?: number;
  /** Operator one-shot override (string ChatterType, or null when none
   *  is pending). Surfaces on the dashboard as a "→ queued" pill. */
  pendingChatterOverride?: string | null;
}

const DAEMON_URL = process.env.NUMA_DAEMON_URL ?? "http://127.0.0.1:4000";

export async function pushToDaemon(
  body: {
    trackId: string;
    sourceUrl: string;
    reason?: string;
    // Routes the push: "shoutout" goes to Liquidsoap's overlay_queue
    // (voice on top of music with sidechain ducking); "music" (default)
    // goes to the priority music queue.
    kind?: "music" | "shoutout";
  },
  fetcher: typeof fetch = fetch,
  timeoutMs = 3_000,
): Promise<{ ok: true; queueItemId: string } | { ok: false; status: number; error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${DAEMON_URL}/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    }
    let parsed: { queueItemId?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, status: 502, error: "daemon returned non-json body" };
    }
    if (!parsed.queueItemId) {
      return { ok: false, status: 502, error: "daemon response missing queueItemId" };
    }
    return { ok: true, queueItemId: parsed.queueItemId };
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: e instanceof Error ? e.message : "daemon unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}

export type RotationRefreshResult = {
  librarySize: number;
  cyclePlayed: number;
  poolSize: number;
  cycleWrapped: boolean;
  manualMode: boolean;
};

export async function setManualRotation(
  trackIds: string[],
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<{ ok: true; result: RotationRefreshResult } | { ok: false; status: number; error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${DAEMON_URL}/manual-rotation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackIds }),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    return { ok: true, result: JSON.parse(text) as RotationRefreshResult };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : "daemon unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function clearManualRotation(
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<{ ok: true; result: RotationRefreshResult } | { ok: false; status: number; error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${DAEMON_URL}/manual-rotation`, {
      method: "DELETE",
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    return { ok: true, result: JSON.parse(text) as RotationRefreshResult };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : "daemon unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestRotationRefresh(
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<{ ok: true; result: RotationRefreshResult } | { ok: false; status: number; error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${DAEMON_URL}/refresh-rotation`, {
      method: "POST",
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    let parsed: RotationRefreshResult;
    try { parsed = JSON.parse(text); }
    catch { return { ok: false, status: 502, error: "daemon returned non-json body" }; }
    return { ok: true, result: parsed };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : "daemon unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDaemonStatus(
  fetcher: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<DaemonStatus> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${DAEMON_URL}/status`, { signal: ctl.signal });
    if (!res.ok) return { lastPushes: [], lastFailures: [] };
    const json = (await res.json()) as DaemonStatus;
    return {
      socket: json.socket,
      lastPushes: Array.isArray(json.lastPushes) ? json.lastPushes : [],
      lastFailures: Array.isArray(json.lastFailures) ? json.lastFailures : [],
      nextChatterSlot:
        typeof json.nextChatterSlot === "number" ? json.nextChatterSlot : undefined,
      pendingChatterOverride:
        typeof json.pendingChatterOverride === "string" ? json.pendingChatterOverride : null,
    };
  } catch {
    return { lastPushes: [], lastFailures: [] };
  } finally {
    clearTimeout(timer);
  }
}
