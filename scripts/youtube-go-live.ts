// Create a YouTube live broadcast with live chat enabled, then bind it
// to the user's existing persistent stream. The encoder (already
// pushing RTMP) auto-starts the broadcast.
//
// Why this exists: YouTube's auto-broadcast flow (RTMP → "Default
// stream" auto-start) does NOT provision a chat session at the API
// level, even with channel-level Customization → Live chat ON. The
// chat appears on the watch page but /liveChatMessages 404s for the
// liveChatId in the broadcast snippet — so the queue-daemon's chat
// poller can't see messages. Manually inserting a broadcast with
// contentDetails.enableLiveChat=true via API DOES provision a real
// chat session.
//
// Usage:
//   npx tsx scripts/youtube-go-live.ts
//
// Requires OAuth credentials with the youtube.force-ssl scope (the
// dashboard health card uses youtube.readonly which is insufficient
// for liveBroadcasts.insert / .bind / .transition). Re-grab a refresh
// token from oauthplayground.google.com with that scope and put it in
// /etc/numa/env, dashboard/.env.local, and Vercel env.

import "../lib/load-env";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";

const TITLE = process.env.YT_BROADCAST_TITLE ?? "Numa Radio Live Stream";
const DESCRIPTION =
  process.env.YT_BROADCAST_DESCRIPTION ??
  [
    "Numa Radio — 24/7 AI radio station hosted by Lena.",
    "Original AI-generated music across the day's mood arc: dawn, prime hours, dusk, late night.",
    "",
    "Type @lena in chat — she'll read your message on air.",
    "Request your own song at https://numaradio.com",
    "",
    "Live now: https://numaradio.com",
    "Stream: https://api.numaradio.com/stream",
  ].join("\n");

async function getAccessToken(): Promise<string> {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing YOUTUBE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN in env",
    );
  }
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`oauth refresh ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("oauth: no access_token");
  return j.access_token;
}

async function api<T>(
  token: string,
  method: string,
  path: string,
  query: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    throw new Error(`youtube ${method} ${path} ${r.status}: ${await r.text()}`);
  }
  return (await r.json()) as T;
}

interface LiveStream {
  id: string;
  snippet?: { title?: string };
  cdn?: { ingestionInfo?: { streamName?: string } };
}

interface LiveBroadcast {
  id: string;
  snippet?: { liveChatId?: string };
  contentDetails?: { enableLiveChat?: boolean };
  status?: { lifeCycleStatus?: string };
}

async function main() {
  const streamKey = process.env.YOUTUBE_STREAM_KEY;
  const token = await getAccessToken();

  console.log("→ listing your liveStreams to find the right one...");
  const streams = await api<{ items?: LiveStream[] }>(
    token,
    "GET",
    "/liveStreams",
    { part: "id,snippet,cdn", mine: "true", maxResults: "10" },
  );
  const items = streams.items ?? [];
  if (items.length === 0) {
    throw new Error("No liveStreams on this channel — set one up in Studio first.");
  }
  console.log(`  found ${items.length}:`);
  for (const s of items) {
    const matches = streamKey && s.cdn?.ingestionInfo?.streamName === streamKey;
    console.log(
      `    id=${s.id}  title="${s.snippet?.title ?? "-"}"  ${matches ? "(matches YOUTUBE_STREAM_KEY)" : ""}`,
    );
  }

  let stream: LiveStream | undefined;
  if (streamKey) {
    stream = items.find((s) => s.cdn?.ingestionInfo?.streamName === streamKey);
  }
  if (!stream) {
    if (items.length === 1) {
      stream = items[0];
      console.log(`  using only stream: ${stream.id}`);
    } else {
      throw new Error(
        "Can't pick a stream — set YOUTUBE_STREAM_KEY to match one of the above, or set only one stream on the channel.",
      );
    }
  }

  console.log("→ creating broadcast with live chat enabled...");
  const broadcast = await api<LiveBroadcast>(
    token,
    "POST",
    "/liveBroadcasts",
    { part: "id,snippet,contentDetails,status" },
    {
      snippet: {
        title: TITLE,
        description: DESCRIPTION,
        scheduledStartTime: new Date(Date.now() + 5_000).toISOString(),
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: false,
        enableDvr: true,
        enableEmbed: true,
        recordFromStart: true,
        enableLowLatency: true,
        latencyPreference: "low",
        // The crucial bit — explicitly ON, not relying on the default.
        enableLiveChat: true,
        monitorStream: { enableMonitorStream: false, broadcastStreamDelayMs: 0 },
      },
    },
  );
  console.log(`  broadcast id=${broadcast.id}`);
  console.log(`  enableLiveChat=${broadcast.contentDetails?.enableLiveChat}`);
  console.log(`  liveChatId=${broadcast.snippet?.liveChatId}`);

  console.log("→ binding broadcast to stream...");
  await api(
    token,
    "POST",
    "/liveBroadcasts/bind",
    {
      part: "id,contentDetails,status",
      id: broadcast.id,
      streamId: stream.id,
    },
  );

  console.log("→ setting category to Music (10)...");
  // Categories live on the underlying video, not the broadcast.
  await api(token, "PUT", "/videos", { part: "snippet" }, {
    id: broadcast.id,
    snippet: {
      title: TITLE,
      description: DESCRIPTION,
      categoryId: "10",
    },
  });

  console.log("");
  console.log("✓ broadcast created.");
  console.log(`  Watch URL: https://www.youtube.com/watch?v=${broadcast.id}`);
  console.log(`  Studio:    https://studio.youtube.com/video/${broadcast.id}/livestreaming`);
  console.log("");
  console.log("Encoder is already pushing RTMP, so the broadcast should");
  console.log("auto-start within ~30s. Once status flips to 'live', post");
  console.log("'@lena hello' in chat and watch the queue-daemon journal:");
  console.log("  journalctl -u numa-queue-daemon -f | grep yt-chat");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
