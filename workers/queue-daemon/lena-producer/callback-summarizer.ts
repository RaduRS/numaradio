import type { ShiftEvent } from "./shift-event.ts";

export interface SummarizerDeps {
  /** Single-call LLM — takes a prompt, returns a one-line description. */
  llm: (prompt: string) => Promise<string>;
}

const PROMPT_HEADER = `Write ONE short past-tense sentence (8-14 words) describing this listener event so a radio DJ can reference it later. No quotes. No emoji. Plain English.`;

export async function summarizeEvent(
  event: ShiftEvent,
  deps: SummarizerDeps,
): Promise<string | null> {
  let prompt: string;
  switch (event.type) {
    case "shoutout_aired":
      prompt = `${PROMPT_HEADER}\n\nEvent: shoutout from ${event.handle}\nMessage: ${event.originalText}`;
      break;
    case "youtube_mention":
      prompt = `${PROMPT_HEADER}\n\nEvent: chat message from ${event.handle}\nMessage: ${event.text}`;
      break;
    case "lena_line_aired":
      if (event.mode !== "aside") return null;
      prompt = `${PROMPT_HEADER}\n\nEvent: earlier on-air aside\nText: ${event.text}`;
      break;
    default:
      return null;
  }

  try {
    const raw = await deps.llm(prompt);
    return raw.trim() || null;
  } catch {
    // Caller (ShiftMemory) keeps the structural fallback description.
    return null;
  }
}
