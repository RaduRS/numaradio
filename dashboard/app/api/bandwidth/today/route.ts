import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { fetchBandwidthToday } from "@/lib/bandwidth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const result = await fetchBandwidthToday(getDbPool());
    if (
      result.sampledRows > 0 &&
      result.unaccountedRows / result.sampledRows > 0.05
    ) {
      console.warn(
        `bandwidth-today: unaccounted=${result.unaccountedRows}/${result.sampledRows} rows missing an audio_stream asset`,
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "query_failed";
    console.error(`bandwidth-today: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
