// POST /api/vote
//
// Latest-wins anonymous thumbs-up / thumbs-down on a track. Body:
//   { trackId: string, sessionId: string, value: 1 | -1 }
// Sends back the current aggregate counts + this session's recorded vote.
//
// Spam posture: anyone can POST, the sessionId is a client-generated UUID
// held in memory. A tab refresh mints a new id and can revote. That's
// acceptable for a vibe gauge — we're not trying to prevent brigading,
// just avoid double-counting the same user's opinion on the same track
// within one tab lifetime.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Vote = 1 | -1;

function isVote(n: unknown): n is Vote {
  return n === 1 || n === -1;
}

export async function POST(req: Request) {
  let body: { trackId?: unknown; sessionId?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const trackId = typeof body.trackId === "string" ? body.trackId : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const value = body.value;

  if (!trackId || trackId.length > 64) {
    return Response.json({ error: "bad trackId" }, { status: 400 });
  }
  if (!UUID_RE.test(sessionId)) {
    return Response.json({ error: "bad sessionId" }, { status: 400 });
  }
  if (!isVote(value)) {
    return Response.json({ error: "value must be 1 or -1" }, { status: 400 });
  }

  // Upsert + count in one round-trip (two queries, one transaction).
  const [, up, down] = await prisma.$transaction([
    prisma.trackVote.upsert({
      where: { trackId_sessionId: { trackId, sessionId } },
      create: { trackId, sessionId, value },
      update: { value },
    }),
    prisma.trackVote.count({ where: { trackId, value: 1 } }),
    prisma.trackVote.count({ where: { trackId, value: -1 } }),
  ]);

  return Response.json({ up, down, mine: value });
}

// GET /api/vote?trackId=X&sessionId=Y — returns the same shape without
// mutating. Used on mount so the UI can show the session's existing
// vote if the user navigates back to a track they already rated.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const trackId = url.searchParams.get("trackId") ?? "";
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!trackId || trackId.length > 64) {
    return Response.json({ error: "bad trackId" }, { status: 400 });
  }

  const [up, down, mineRow] = await Promise.all([
    prisma.trackVote.count({ where: { trackId, value: 1 } }),
    prisma.trackVote.count({ where: { trackId, value: -1 } }),
    UUID_RE.test(sessionId)
      ? prisma.trackVote.findUnique({
          where: { trackId_sessionId: { trackId, sessionId } },
          select: { value: true },
        })
      : Promise.resolve(null),
  ]);

  return Response.json({ up, down, mine: mineRow?.value ?? null });
}
