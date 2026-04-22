const MINIMAX_MUSIC_URL = "https://api.minimax.io/v1/music_generation";
const MUSIC_MODEL = process.env.MINIMAX_MUSIC_MODEL ?? "music-2.6";

// Belt-and-braces duration hint. music-2.6 primarily sizes the song by
// the `lyrics` text length (see prompt-expand.ts), but for instrumental
// tracks there's no lyrics to anchor against — appending this nudge to
// the prompt helps the model commit to a full-length composition instead
// of a ~60s sketch.
const DURATION_HINT =
  "A full-length song of about 2 to 3 minutes, with intro, development, and outro.";

export interface StartMusicInput {
  prompt: string;
  lyrics?: string;
  isInstrumental: boolean;
}

export interface StartMusicResult {
  taskId: string;
  immediateAudioUrl?: string;
  durationMs?: number;
}

export interface PollMusicResult {
  status: "pending" | "done" | "failed";
  audioUrl?: string;
  durationMs?: number;
  failureReason?: string;
}

export function normalizeDurationMs(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1_000_000_000) return Math.round(n / 1_000_000);
  if (n > 1_000_000) return Math.round(n / 1_000);
  if (n < 600_000) return Math.round(n);
  return Math.round(n / 44.1);
}

function apiKey(): string {
  const k = process.env.MINIMAX_API_KEY;
  if (!k) throw new Error("MINIMAX_API_KEY not set");
  return k;
}

export async function startMusicGeneration(
  input: StartMusicInput,
): Promise<StartMusicResult> {
  const prompt = `${input.prompt.trim()}. ${DURATION_HINT}`;
  const body: Record<string, unknown> = {
    model: MUSIC_MODEL,
    prompt,
    is_instrumental: input.isInstrumental,
    lyrics_optimizer: true,
    stream: false,
    output_format: "url",
  };
  if (!input.isInstrumental && input.lyrics && input.lyrics.trim().length > 0) {
    body.lyrics = input.lyrics.trim();
  }

  const res = await fetch(MINIMAX_MUSIC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`minimax music start ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    status?: number;
    task_id?: string;
    audio?: string;
    data?: { status?: number; task_id?: string; audio?: string; extra_info?: { duration?: unknown } };
    extra_info?: { duration?: unknown };
  };
  const node = data.data ?? data;
  const taskId = node.task_id ?? data.task_id;
  const immediateAudio = node.audio ?? data.audio;
  // music-2.6 responds in two shapes: async with {task_id,...} for the
  // poll loop, or sync with {audio,...} when generation finishes inside
  // the initial request window. Reject only if neither is present.
  if (!taskId && !immediateAudio) {
    throw new Error("minimax music start: neither task_id nor audio in response");
  }
  const durationMs = normalizeDurationMs(
    node.extra_info?.duration ?? data.extra_info?.duration,
  );
  return {
    taskId: taskId ?? "",
    immediateAudioUrl: immediateAudio,
    durationMs: durationMs || undefined,
  };
}

export async function pollMusicGeneration(taskId: string): Promise<PollMusicResult> {
  const url = `${MINIMAX_MUSIC_URL}?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey()}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`minimax music poll ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    status?: number | string;
    audio?: string;
    data?: { status?: number | string; audio?: string; extra_info?: { duration?: unknown } };
    extra_info?: { duration?: unknown };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const node = data.data ?? data;
  const rawStatus = node.status ?? data.status;
  const audio = node.audio ?? data.audio;
  const durationMs = normalizeDurationMs(
    node.extra_info?.duration ?? data.extra_info?.duration,
  );

  // MiniMax music-2.6 uses integer statuses: 1=queued, 2=in-progress,
  // 3=done, 4=failed (per the reference implementation's response
  // handling at ~/examples/make-noise/app/page.tsx:301). If the API
  // returns strings instead, the heuristics below still cover it.
  if (audio && (rawStatus === 3 || rawStatus === "done" || rawStatus === "success")) {
    return { status: "done", audioUrl: audio, durationMs: durationMs || undefined };
  }
  if (
    rawStatus === 4 ||
    rawStatus === "failed" ||
    (data.base_resp?.status_code && data.base_resp.status_code !== 0)
  ) {
    return {
      status: "failed",
      failureReason:
        data.base_resp?.status_msg ?? `status=${String(rawStatus)}`,
    };
  }
  return { status: "pending" };
}
