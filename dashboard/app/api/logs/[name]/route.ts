import { NextResponse } from "next/server";
import { SERVICE_NAMES, tailServiceLogs, type ServiceName } from "@/lib/systemd";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await ctx.params;
  if (!SERVICE_NAMES.includes(name as ServiceName)) {
    return NextResponse.json({ ok: false, error: "invalid service" }, { status: 400 });
  }
  const url = new URL(req.url);
  const linesParam = Number(url.searchParams.get("lines") ?? "50");
  const { lines, error } = await tailServiceLogs(name as ServiceName, linesParam);
  return NextResponse.json(
    { name, lines, error },
    { headers: { "Cache-Control": "no-store" } },
  );
}
