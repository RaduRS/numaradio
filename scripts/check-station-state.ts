import "../lib/load-env.ts";
import { prisma } from "../lib/db/index.ts";

async function main() {
  const s = await prisma.station.findFirst({
    select: {
      autoHostMode: true,
      autoHostForcedUntil: true,
      autoHostForcedBy: true,
      worldAsideMode: true,
      worldAsideForcedUntil: true,
      worldAsideForcedBy: true,
      updatedAt: true,
    },
  });
  console.log("now:", new Date().toISOString());
  console.log("updatedAt:", s?.updatedAt?.toISOString());
  console.log("---autoHost---");
  console.log("mode:", s?.autoHostMode);
  console.log("forcedUntil:", s?.autoHostForcedUntil?.toISOString() ?? "(null)");
  console.log("forcedBy:", s?.autoHostForcedBy ?? "(null)");
  console.log("---worldAside---");
  console.log("mode:", s?.worldAsideMode);
  console.log("forcedUntil:", s?.worldAsideForcedUntil?.toISOString() ?? "(null)");
  console.log("forcedBy:", s?.worldAsideForcedBy ?? "(null)");
  await prisma.$disconnect();
}
main();
