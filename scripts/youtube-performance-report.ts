// One-shot: list every video on the authed YouTube channel ranked by
// view count. Uses the existing dashboard OAuth refresh token (scope
// `youtube.readonly`). Public stats only — analytics (retention,
// traffic source, watch time) require a separate scope.
//
// Run: npx tsx scripts/youtube-performance-report.ts

import { readFileSync } from "node:fs";

for (const envPath of [
  `${process.cwd()}/dashboard/.env.local`,
  `${process.cwd()}/.env.local`,
]) {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      const v = vRaw.replace(/\r$/, "").replace(/^"(.*)"$/, "$1");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";

const CLIENT_ID = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("Missing YOUTUBE_OAUTH_* env vars. Check .env.local / dashboard/.env.local.");
  process.exit(1);
}

async function getAccessToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function apiGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const token = await getAccessToken();

  const channelRes = await apiGet(
    "/channels?part=snippet,statistics,contentDetails&mine=true",
    token,
  );
  const channel = channelRes.items?.[0];
  if (!channel) throw new Error("No channel for authed user");

  const uploadsPlaylist = channel.contentDetails.relatedPlaylists.uploads;
  console.log(`Channel: ${channel.snippet.title}`);
  console.log(`Subscribers: ${channel.statistics.subscriberCount}`);
  console.log(`Total views: ${channel.statistics.viewCount}`);
  console.log(`Total videos: ${channel.statistics.videoCount}`);
  console.log(`Uploads playlist: ${uploadsPlaylist}`);
  console.log("");

  const videoIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      part: "contentDetails",
      playlistId: uploadsPlaylist,
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await apiGet(`/playlistItems?${params}`, token);
    for (const item of page.items ?? []) {
      videoIds.push(item.contentDetails.videoId);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  console.log(`Found ${videoIds.length} videos. Fetching stats…\n`);

  const stats: Array<{
    id: string;
    title: string;
    publishedAt: string;
    duration: string;
    views: number;
    likes: number;
    comments: number;
    isShort: boolean;
  }> = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50).join(",");
    const params = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      id: batch,
    });
    const page = await apiGet(`/videos?${params}`, token);
    for (const v of page.items ?? []) {
      const duration = v.contentDetails.duration as string;
      const durSec = parseISO8601Seconds(duration);
      stats.push({
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        duration,
        views: Number(v.statistics.viewCount ?? 0),
        likes: Number(v.statistics.likeCount ?? 0),
        comments: Number(v.statistics.commentCount ?? 0),
        isShort: durSec <= 60,
      });
    }
  }

  stats.sort((a, b) => b.views - a.views);

  console.log("=== ALL VIDEOS, RANKED BY VIEWS ===\n");
  for (const s of stats) {
    const tag = s.isShort ? "SHORT" : "LONG ";
    console.log(
      `[${tag}] ${String(s.views).padStart(6)} v · ${String(s.likes).padStart(4)} l · ${String(s.comments).padStart(3)} c · ${s.publishedAt.slice(0, 10)} · ${s.duration.padEnd(8)} · ${s.title}`,
    );
  }

  console.log("");
  console.log("=== SUMMARY ===");
  const shorts = stats.filter((s) => s.isShort);
  const longs = stats.filter((s) => !s.isShort);
  console.log(`Shorts: ${shorts.length} · total views ${shorts.reduce((a, b) => a + b.views, 0)}`);
  console.log(`Long-form: ${longs.length} · total views ${longs.reduce((a, b) => a + b.views, 0)}`);
}

function parseISO8601Seconds(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return Number.POSITIVE_INFINITY;
  const [, h = "0", min = "0", s = "0"] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
