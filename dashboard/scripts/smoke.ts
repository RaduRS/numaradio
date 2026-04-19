import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3099;

async function waitForReady(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* keep trying */
    }
    await sleep(500);
  }
  throw new Error(`server never became ready at ${url}`);
}

async function main() {
  const child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: false,
  });
  try {
    await waitForReady(`http://localhost:${PORT}`);
    const res = await fetch(`http://localhost:${PORT}/api/status`);
    if (!res.ok) throw new Error(`/api/status returned ${res.status}`);
    const json = (await res.json()) as {
      ts: string;
      stream: { reachable: boolean };
      services: { state: string }[];
      health: { neon: { ok: boolean }; b2: { ok: boolean }; tunnel: { ok: boolean } };
    };
    if (!json.ts) throw new Error("missing ts");
    if (!json.stream.reachable) throw new Error("stream not reachable — is the broadcast stack running?");
    if (json.services.length !== 3) throw new Error(`expected 3 services, got ${json.services.length}`);
    for (const s of json.services) {
      if (s.state !== "active") throw new Error(`service not active: ${JSON.stringify(s)}`);
    }
    if (!json.health.neon.ok) throw new Error("neon not ok");
    if (!json.health.b2.ok) throw new Error("b2 not ok");
    if (!json.health.tunnel.ok) throw new Error("tunnel not ok");
    console.log("✓ smoke passed");
  } finally {
    child.kill("SIGINT");
  }
}

main().catch((e) => {
  console.error("✗ smoke failed:", e);
  process.exit(1);
});
