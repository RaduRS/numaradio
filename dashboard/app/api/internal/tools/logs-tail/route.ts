import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

// Services the chat tool can tail logs for. Broader than service-restart
// because tailing is read-only and safe.
const ALLOWED_SERVICES = new Set<string>([
  "numa-liquidsoap",
  "numa-queue-daemon",
  "numa-song-worker",
  "numa-dashboard",
  "icecast2",
  "cloudflared",
  "numa-rotation-refresher",
]);

export async function GET(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const service = url.searchParams.get("service") ?? "";
  const linesRaw = Number(url.searchParams.get("lines") ?? "80");
  const lines = Math.max(1, Math.min(500, Math.floor(linesRaw) || 80));
  if (!ALLOWED_SERVICES.has(service)) {
    return NextResponse.json(
      {
        ok: false,
        error: `service '${service}' not in log-tail allowlist`,
        allowed: [...ALLOWED_SERVICES],
      },
      { status: 400 },
    );
  }

  const result = await new Promise<{ ok: boolean; out: string; err: string }>(
    (resolve) => {
      const child = spawn(
        "journalctl",
        ["-u", service, "-n", String(lines), "--no-pager", "-o", "short-iso"],
        { shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      child.stdout?.on("data", (c) => (out += c.toString()));
      child.stderr?.on("data", (c) => (err += c.toString()));
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, out, err: err.trim() });
      });
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.err || "journalctl failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    service,
    lines: result.out.split("\n").filter((l) => l.length > 0),
  });
}
