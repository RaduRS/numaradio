import type { IncomingMessage, ServerResponse, RequestListener } from "node:http";

export type PushKind = "music" | "shoutout";

export type PushAnnounce = {
  /** Listener's requested artist name (falls back to station name in song-worker). */
  listenerName: string;
  /** Whatever the listener originally typed into the song-request form. */
  userPrompt: string;
  /** LLM-generated song title. */
  title: string;
};

export type PushBody = {
  trackId: string;
  sourceUrl: string;
  requestId?: string;
  reason?: string;
  // Routes to a different Liquidsoap source. Shoutouts go to the overlay
  // queue (voice on top of music), music goes to the priority music queue
  // (replaces rotation at track boundary). Default: "music".
  kind?: PushKind;
  /**
   * Optional. When present on a "music" push, the queue-daemon pre-generates
   * a Lena-voice intro for this track and plays it over the song's opening
   * seconds on FIRST air. Used by the song-worker for listener-generated
   * songs. Ignored for shoutout kinds.
   */
  announce?: PushAnnounce;
};

export type OnTrackBody = {
  sourceUrl?: string;
  trackId?: string;
  title?: string;
  artist?: string;
};

export type StatusSnapshot = {
  socket: "connected" | "reconnecting";
  lastPushes: unknown[];
  lastFailures: unknown[];
  /**
   * Most recent hydrate() failure, or null if hydrate has been clean
   * since boot (or recovered since the last error). Surfaced in
   * /status so the dashboard can flag a stuck queue-staging path
   * rather than silently logging to stderr.
   */
  lastHydrationError: { at: string; message: string } | null;
  /**
   * Auto-chatter rotation pointer — the slot index (mod 20) that the
   * NEXT chatter break will use. The dashboard renders the upcoming
   * slot type ("next: world_aside") + a short preview of the next
   * few slots so operators can see what's coming.
   */
  nextChatterSlot: number;
  /**
   * Operator-set one-shot override (set via POST /chatter-override).
   * When non-null, the next chatter break uses this type instead of
   * the rotation. Cleared automatically once the next break consumes
   * it. Surfaced so the dashboard can show "→ world_aside (queued)"
   * on the corresponding chip.
   */
  pendingChatterOverride: string | null;
};

/** Operator-set one-shot override: {type: ChatterType-like-string}. */
export interface ChatterOverrideBody {
  type: string;
}

export type RefreshRotationResult = {
  librarySize: number;
  cyclePlayed: number;
  poolSize: number;
  cycleWrapped: boolean;
  manualMode: boolean;
};

export type SetManualRotationBody = { trackIds: string[] };

export interface ServerDeps {
  pushHandler(body: PushBody): Promise<{ queueItemId: string }>;
  onTrackHandler(body: OnTrackBody): Promise<void>;
  refreshRotationHandler(): Promise<RefreshRotationResult>;
  setManualRotationHandler(body: SetManualRotationBody): Promise<RefreshRotationResult>;
  clearManualRotationHandler(): Promise<RefreshRotationResult>;
  statusHandler(): StatusSnapshot;
  /** Set the next chatter type. Validates the type or throws. */
  chatterOverrideHandler(body: ChatterOverrideBody): { ok: true };
}

const VALID_OVERRIDE_TYPES = new Set([
  "back_announce",
  "shoutout_cta",
  "song_cta",
  "filler",
  "world_aside",
]);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Accepted URL schemes for Liquidsoap playback. file:// is used for
// local on-disk MP3s (shoutouts staged by dashboard); http(s) is for
// B2 / CDN URLs. Anything else is a sign of confusion or abuse.
const VALID_PUSH_URL = /^(https?:|file:)\/\//i;

export function validatePushUrl(sourceUrl: string): string | null {
  // Whitespace in a sourceUrl is dangerous: the daemon passes the URL
  // into Liquidsoap's telnet protocol as part of a single-line command
  // (`priority.push <url>\n`). A caller that slips in a `\n` could
  // terminate the push command early and inject additional telnet
  // verbs. A legitimate URL is always whitespace-free because HTTP/
  // file URIs require percent-encoding.
  if (/\s/.test(sourceUrl)) return "sourceUrl contains whitespace";
  if (!VALID_PUSH_URL.test(sourceUrl)) {
    return "sourceUrl must be http(s) or file";
  }
  return null;
}

export function createHandler(deps: ServerDeps): RequestListener {
  return async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/push") {
        const text = await readBody(req);
        let body: PushBody;
        try {
          body = JSON.parse(text);
        } catch {
          return sendJson(res, 400, { error: "invalid json" });
        }
        if (!body?.trackId || !body?.sourceUrl) {
          return sendJson(res, 400, { error: "missing trackId or sourceUrl" });
        }
        if (typeof body.sourceUrl !== "string") {
          return sendJson(res, 400, { error: "sourceUrl must be a string" });
        }
        const urlErr = validatePushUrl(body.sourceUrl);
        if (urlErr) {
          return sendJson(res, 400, { error: urlErr });
        }
        const result = await deps.pushHandler(body);
        return sendJson(res, 200, result);
      }
      if (req.method === "POST" && req.url === "/on-track") {
        const text = await readBody(req);
        let body: OnTrackBody;
        try {
          body = JSON.parse(text);
        } catch {
          return sendJson(res, 400, { error: "invalid json" });
        }
        await deps.onTrackHandler(body);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && req.url === "/status") {
        return sendJson(res, 200, deps.statusHandler());
      }
      if (req.method === "POST" && req.url === "/refresh-rotation") {
        const result = await deps.refreshRotationHandler();
        return sendJson(res, 200, result);
      }
      if (req.method === "POST" && req.url === "/manual-rotation") {
        const text = await readBody(req);
        let body: SetManualRotationBody;
        try { body = JSON.parse(text); }
        catch { return sendJson(res, 400, { error: "invalid json" }); }
        if (!body || !Array.isArray(body.trackIds)) {
          return sendJson(res, 400, { error: "trackIds must be an array" });
        }
        if (body.trackIds.some((x) => typeof x !== "string")) {
          return sendJson(res, 400, { error: "trackIds must be strings" });
        }
        const result = await deps.setManualRotationHandler(body);
        return sendJson(res, 200, result);
      }
      if (req.method === "DELETE" && req.url === "/manual-rotation") {
        const result = await deps.clearManualRotationHandler();
        return sendJson(res, 200, result);
      }
      if (req.method === "POST" && req.url === "/chatter-override") {
        const text = await readBody(req);
        let body: ChatterOverrideBody;
        try {
          body = JSON.parse(text);
        } catch {
          return sendJson(res, 400, { error: "invalid json" });
        }
        if (!body?.type || typeof body.type !== "string") {
          return sendJson(res, 400, { error: "missing type" });
        }
        if (!VALID_OVERRIDE_TYPES.has(body.type)) {
          return sendJson(res, 400, {
            error: "invalid type",
            allowed: [...VALID_OVERRIDE_TYPES],
          });
        }
        return sendJson(res, 200, deps.chatterOverrideHandler(body));
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const statusCode = typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, statusCode, { error: statusCode >= 500 ? "internal" : "bad request", message: msg });
    }
  };
}
