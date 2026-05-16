
const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = process.env.MINIMAX_HUMANIZE_MODEL ?? "MiniMax-M2.7";

export async function callMiniMaxJson(
  prompts: { system: string; user: string },
  opts: { apiKey: string; fetcher?: typeof fetch } = { apiKey: process.env.MINIMAX_API_KEY ?? "" },
): Promise<string> {
  const fetcher = opts.fetcher ?? fetch;
  if (!opts.apiKey) throw new Error("MINIMAX_API_KEY is not set");
  const res = await fetcher(MINIMAX_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, temperature: 0.9, system: prompts.system, messages: [{ role: "user", content: prompts.user }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`minimax http ${res.status}`);
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((b) => b.type === "text" && b.text)?.text ?? "";
  return text.trim();
}
