import type { PromptPair } from "./chatter-prompts.ts";

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const DEFAULT_MODEL = process.env.MINIMAX_HUMANIZE_MODEL ?? "MiniMax-M2.7";
const MAX_TOKENS = 200;

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

function cleanModelOutput(raw: string): string {
  let s = raw.trim();
  s = s.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
  const lines = s.split(/\n/).map((l) => l.trim());
  const startIdx = lines.findIndex(
    (l) =>
      l &&
      !/^(sure|here('s| is)|okay|ok)[,!.:]/i.test(l) &&
      !/^rewrite|^output:|^result:/i.test(l),
  );
  const cleaned = (startIdx >= 0 ? lines.slice(startIdx) : lines)
    .filter((l) => l.length > 0)
    .join(" ")
    .trim();
  return cleaned.replace(/^["'`](.+)["'`]$/s, "$1").trim();
}

function isSuspicious(text: string): boolean {
  if (!text) return true;
  return /\b(as an? (ai|assistant|language model)|i (can't|cannot|won't))\b/i.test(text);
}

export interface GenerateOpts {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
}

export async function generateChatterScript(
  prompts: PromptPair,
  opts: GenerateOpts,
): Promise<string> {
  if (!opts.apiKey) throw new Error("MINIMAX_API_KEY is not set");
  const fetcher = opts.fetcher ?? fetch;
  const model = opts.model ?? DEFAULT_MODEL;

  const res = await fetcher(MINIMAX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: prompts.system,
      messages: [{ role: "user", content: prompts.user }],
    }),
  });

  if (!res.ok) throw new Error(`minimax http ${res.status}`);

  const data = (await res.json()) as AnthropicResponse;
  const raw = data.content?.find((b) => b.type === "text" && b.text)?.text ?? "";
  const cleaned = cleanModelOutput(raw);
  if (!cleaned) throw new Error("empty script from minimax");
  if (isSuspicious(cleaned)) throw new Error(`suspicious model output: ${cleaned.slice(0, 100)}`);
  return cleaned;
}
