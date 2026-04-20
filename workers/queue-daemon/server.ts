import type { IncomingMessage, ServerResponse, RequestListener } from "node:http";

export type PushBody = {
  trackId: string;
  sourceUrl: string;
  requestId?: string;
  reason?: string;
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
