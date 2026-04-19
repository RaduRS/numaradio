import { NextResponse } from "next/server";
import {
  validateServiceAction,
  runServiceAction,
  getServiceState,
} from "@/lib/systemd";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ name: string; action: string }> },
): Promise<NextResponse> {
  const { name: rawName, action: rawAction } = await ctx.params;
  let validated;
  try {
    validated = validateServiceAction(rawName, rawAction);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "invalid input" },
      { status: 400 },
    );
  }
  const result = await runServiceAction(validated.name, validated.action);
  const post = await getServiceState(validated.name);
  const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";
  console.info(
    `action=${validated.action} service=${validated.name} user=${user} ok=${result.ok} duration=${result.durationMs}ms`,
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.stderr ?? "action failed", state: post.state, durationMs: result.durationMs },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    state: post.state,
    durationMs: result.durationMs,
  });
}
