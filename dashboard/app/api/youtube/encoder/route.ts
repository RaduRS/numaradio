// GET  /api/youtube/encoder       → systemd state of numa-youtube-encoder
// POST /api/youtube/encoder       → body {action: "start"|"stop"|"restart"}
//
// Auth: Cloudflare Access in front of the dashboard. We pull the
// operator email from the CF-forwarded header for the audit log,
// same pattern as the shoutouts approve/reject routes.
//
// Sudoers (deploy/systemd/numa-nopasswd.sudoers) already permits
// marku to run `systemctl {start,stop,restart,status}
// numa-youtube-encoder` without a password.

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const SERVICE = "numa-youtube-encoder";
const ALLOWED_ACTIONS = new Set(["start", "stop", "restart"]);

function runSystemctl(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("sudo", ["-n", "systemctl", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: 1, stdout: "", stderr: err.message }),
    );
  });
}

export async function GET(): Promise<NextResponse> {
  // `is-active` exits 0 with "active" / non-zero with the actual
  // state ("inactive", "failed", "activating") — both are useful.
  const r = await runSystemctl(["is-active", SERVICE]);
  const state = (r.stdout.trim() || r.stderr.trim() || "unknown") as string;
  return NextResponse.json(
    { state, ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { action?: unknown };
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: `action must be start | stop | restart` },
      { status: 400 },
    );
  }
  const rawEmail = req.headers.get("cf-access-authenticated-user-email") ?? "";
  const operator = /^[^@\s]+@[^@\s]+$/.test(rawEmail) ? rawEmail : "operator";

  const r = await runSystemctl([action, SERVICE]);
  if (r.code !== 0) {
    return NextResponse.json(
      { ok: false, error: r.stderr || "systemctl returned non-zero" },
      { status: 500 },
    );
  }
  console.info(
    `action=youtube-encoder-${action} operator=${operator} stdout="${r.stdout.trim().slice(0, 120)}"`,
  );
  return NextResponse.json({ ok: true, action });
}
