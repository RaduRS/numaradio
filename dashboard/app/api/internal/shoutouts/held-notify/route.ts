import { NextResponse } from "next/server";
import { internalAuthOk } from "@/lib/internal-auth";
import { writeIpcMessage } from "@/lib/ipc-writer";

export const dynamic = "force-dynamic";

function formatTelegramText(input: {
  rawText: string;
  cleanText?: string;
  requesterName?: string;
  moderationReason?: string;
  id: string;
}): string {
  const from = input.requesterName?.trim() || "anonymous";
  const bodyText = (input.cleanText?.trim() || input.rawText.trim()).slice(0, 300);
  const reason = input.moderationReason?.trim() || "no specific reason";
  return [
    "🎙 *Held shoutout awaiting your call*",
    "",
    `From: ${from}`,
    `_"${bodyText}"_`,
    "",
    `Moderator flagged: ${reason}`,
    "",
    `ID: \`${input.id}\``,
    "",
    "Reply *yes* to air or *no* to block.",
  ].join("\n");
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ipcDir = process.env.NANOCLAW_IPC_DIR;
  const chatJid = process.env.TELEGRAM_OPERATOR_CHAT_JID;
  if (!ipcDir || !chatJid) {
    console.warn(
      "held-notify: NANOCLAW_IPC_DIR or TELEGRAM_OPERATOR_CHAT_JID not set; skipping",
    );
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  let body: {
    id?: unknown;
    rawText?: unknown;
    cleanText?: unknown;
    requesterName?: unknown;
    moderationReason?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const rawText = typeof body.rawText === "string" ? body.rawText : "";
  if (!id || !rawText) {
    return NextResponse.json(
      { ok: false, error: "id_and_rawText_required" },
      { status: 400 },
    );
  }

  try {
    await writeIpcMessage({
      dir: ipcDir,
      shoutoutId: id,
      chatJid,
      // Guarantee the agent's next session sees this prompt in context,
      // regardless of what NanoClaw's default evolves to — otherwise the
      // operator replies "no" and the agent has no idea what was being
      // rejected. Paired with the NanoClaw-side fix that persists
      // agent-addressed IPC messages to SQLite before Telegram-send.
      persistInContext: true,
      senderName: "Dashboard",
      text: formatTelegramText({
        id,
        rawText,
        cleanText: typeof body.cleanText === "string" ? body.cleanText : undefined,
        requesterName:
          typeof body.requesterName === "string" ? body.requesterName : undefined,
        moderationReason:
          typeof body.moderationReason === "string"
            ? body.moderationReason
            : undefined,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ipc_write_failed";
    console.error(`held-notify: ipc write failed row=${id} err=${msg}`);
    return NextResponse.json(
      { ok: false, error: "ipc_write_failed", detail: msg },
      { status: 500 },
    );
  }

  console.info(`action=held-notify row=${id}`);
  return NextResponse.json({ ok: true });
}
