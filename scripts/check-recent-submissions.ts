import "../lib/load-env.ts";
import { prisma } from "../lib/db/index.ts";

async function main() {
  const recent = await prisma.musicSubmission.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      artistName: true,
      email: true,
      status: true,
      audioStorageKey: true,
      artworkStorageKey: true,
      durationSeconds: true,
      createdAt: true,
    },
  });
  for (const r of recent) {
    const ageMin = Math.floor((Date.now() - r.createdAt.getTime()) / 60000);
    console.log(
      `[${ageMin}m ago] ${r.status.padEnd(9)} ${r.artistName} <${r.email}> dur=${r.durationSeconds}s audio=${r.audioStorageKey ? "Y" : "-"} art=${r.artworkStorageKey ? "Y" : "-"}`,
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
