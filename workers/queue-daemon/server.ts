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
};

export interface ServerDeps {
  pushHandler(body: PushBody): Promise<{ queueItemId: string }>;
  onTrackHandler(body: OnTrackBody): Promise<void>;
  statusHandler(): StatusSnapshot;
}

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
