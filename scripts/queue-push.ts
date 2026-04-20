import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(flag));
  return hit?.slice(flag.length);
}

async function main() {
  const trackId = arg("trackId");
  const reason = arg("reason");
  if (!trackId) {
    console.error("usage: npm run queue:push -- --trackId=<id> [--reason=<text>]");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        assets: {
          where: { assetType: "audio_stream" },
          take: 1,
          select: { publicUrl: true },
        },
      },
    });
    if (!track) throw new Error(`no track with id=${trackId}`);
    const url = track.assets[0]?.publicUrl;
    if (!url) throw new Error(`track ${trackId} has no audio_stream asset`);

    const daemon = process.env.NUMA_DAEMON_URL ?? "http://127.0.0.1:4000";
    const res = await fetch(`${daemon}/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId, sourceUrl: url, reason }),
    });
    const body = await res.text();
    console.log(`[queue:push] ${res.status} ${body}`);
    if (!res.ok) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[queue:push] failed", err);
  process.exit(1);
});
