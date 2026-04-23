// Client-side parser for the structured inline tags the agent emits.
// Mirrors nanoclaw/src/channels/http-tags.ts so we can apply the same
// cleanup to messages loaded from /chat/history — those were stored
// verbatim (tags and all) and need to be parsed into plain prose +
// action chips before rendering.

import type { ChatAction } from "@/lib/chat-types";

export interface ParsedAgentReply {
  plain: string;
  actions: ChatAction[];
}

function readAttr(attrs: string, key: string): string | undefined {
  const re = new RegExp(`\\b${key}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  const m = attrs.match(re);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? "";
}

function parseArgs(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

let counter = 0;
function nextId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_h_${counter.toString(36)}`;
}

/**
 * Strip <internal>, <action/>, <confirm>…</confirm> tags from an agent
 * reply. Returns cleaned prose plus whatever action chips we parsed out.
 * Confirms aren't rehydrated from history (they're transient) — we just
 * remove them from the text so they don't render as literal XML.
 */
export function parseAgentReplyClient(raw: string): ParsedAgentReply {
  // 1. <internal>…</internal>
  let out = raw.replace(/<internal>[\s\S]*?<\/internal>/g, "");

  const actions: ChatAction[] = [];

  // 2. <action …/> and <action …></action>
  out = out.replace(
    /<action\b([^>]*?)(?:\/>|>\s*<\/action\s*>)/gi,
    (_full, attrs: string) => {
      const name = readAttr(attrs, "name");
      if (!name) return "";
      actions.push({
        id: readAttr(attrs, "id") ?? nextId("a"),
        name,
        args: parseArgs(readAttr(attrs, "args")),
        at: new Date().toISOString(),
        resultSummary: readAttr(attrs, "result"),
        resultOk: true,
      });
      return "";
    },
  );

  // 3. <confirm …>body</confirm> — just strip, body is gone
  out = out.replace(/<confirm\b[^>]*>[\s\S]*?<\/confirm\s*>/gi, "");

  return { plain: out.trim(), actions };
}
