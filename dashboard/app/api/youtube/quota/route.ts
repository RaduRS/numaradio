import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { fetchYoutubeQuotaSnapshot } from "@/lib/youtube-quota";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

interface ChatPollRow {
  youtubeChatPollMs: number;
}

// Combined endpoint: today's quota usage + the operator-tunable
// chat-poll cadence. The dashboard's YouTube card reads both at
// once so the quota meter and the slider stay in sync.
export async function GET() {
  const [snap, pollRow] = await Promise.all([
    fetchYoutubeQuotaSnapshot(),
    getDbPool()
      .query<ChatPollRow>(
        `SELECT "youtubeChatPollMs" FROM "Station" WHERE slug = $1 LIMIT 1`,
        [STATION_SLUG],
      )
      .then((r) => r.rows[0] ?? null),
  ]);
  return NextResponse.json(
    {
      quota: snap,
      youtubeChatPollMs: pollRow?.youtubeChatPollMs ?? 90_000,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
