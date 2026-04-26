import { NextResponse } from "next/server";
import { fetchDaemonStatus } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const status = await fetchDaemonStatus();
  return NextResponse.json(
    {
      lastPushes: status.lastPushes,
      lastFailures: status.lastFailures,
      nextChatterSlot: status.nextChatterSlot,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
