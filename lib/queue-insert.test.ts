import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueueItemAtomically } from "./queue-insert.ts";

test("createQueueItemAtomically passes data through $transaction and computes position from top+1", async () => {
  let topSeen = false;
  let createdData: any = null;
  const fakePrisma = {
    $transaction: async (fn: any) => {
      const fakeTx = {
        $executeRaw: async () => 0,
        queueItem: {
          findFirst: async () => { topSeen = true; return { positionIndex: 5 }; },
          create: async ({ data }: any) => { createdData = data; return { id: "new" }; },
        },
      };
      return fn(fakeTx);
    },
  };
  const r = await createQueueItemAtomically(fakePrisma as never, "sid1", {
    stationId: "sid1",
    queueType: "music",
    sourceObjectType: "track",
    sourceObjectId: "t1",
    trackId: "t1",
    priorityBand: "priority_request",
    queueStatus: "planned",
  } as never);
  assert.equal(r.id, "new");
  assert.equal(topSeen, true);
  assert.equal(createdData.positionIndex, 6);
});
