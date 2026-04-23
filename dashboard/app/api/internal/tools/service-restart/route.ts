import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

// Services the chat tool is allowed to restart. Narrower than the
// dashboard UI's service allowlist — this is the operator-via-agent
// surface, not the direct operator surface, so we keep it to the units
// the sudoers drop-in already allows password-less restart of (see
// `deploy/systemd/numa-nopasswd.sudoers`).
//
// Deliberately excluded:
//   - `numa-dashboard` — restarting this cuts the chat's own connection.
//   - `icecast2`       — not in sudoers; would prompt and fail.
const ALLOWED_SERVICES = new Set<string>([
  "numa-liquidsoap",
  "numa-queue-daemon",
  "numa-song-worker",
]);

interface Body {
  service?: unknown;
  operator?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const service = typeof body.service === "string" ? body.service : "";
  const operator =
    typeof body.operator === "string" ? body.operator : "chat:unknown";
  if (!ALLOWED_SERVICES.has(service)) {
    return NextResponse.json(
      {
        ok: false,
        error: `service '${service}' not in chat-tool allowlist`,
        allowed: [...ALLOWED_SERVICES],
      },
      { status: 400 },
    );
  }

  const start = Date.now();
  const result = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    const child = spawn(
      "sudo",
      ["-n", "systemctl", "restart", service],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (c) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stderr: stderr.trim() });
    });
  });

  const durationMs = Date.now() - start;
  console.info(
    `action=service-restart service=${service} operator=${operator} ok=${result.ok} durationMs=${durationMs}`,
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.stderr || "systemctl returned non-zero" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, service, durationMs });
}
