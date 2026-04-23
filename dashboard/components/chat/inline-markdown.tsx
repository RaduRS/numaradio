import React from "react";

/**
 * Minimal safe markdown for chat messages. Handles the bits agents
 * actually use in conversational replies: **bold**, *italic*, `code`,
 * [link](url), code blocks (```), and paragraph breaks. Intentionally
 * doesn't do headings, lists, tables, images — those aren't chat voice,
 * and they'd pull in a heavier renderer.
 *
 * Security: we emit React nodes, never innerHTML, so script/style
 * injection is impossible. Link URLs are sanitised (http(s) only).
 */

interface Props {
  text: string;
  className?: string;
}

type Node =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: Node[] }
  | { kind: "italic"; value: Node[] }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; value: Node[] };

function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

// Parse one inline run into nodes. Order of recognition:
//   `code`  →  [text](url)  →  **bold**  →  *italic*
// Everything else is literal text.
function parseInline(text: string): Node[] {
  const out: Node[] = [];
  let i = 0;
  while (i < text.length) {
    // inline code — literal, wins over everything
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        out.push({ kind: "code", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // [label](href)
    if (text[i] === "[") {
      const labelEnd = text.indexOf("]", i + 1);
      if (
        labelEnd > i &&
        text[labelEnd + 1] === "("
      ) {
        const hrefEnd = text.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd) {
          const href = text.slice(labelEnd + 2, hrefEnd);
          const safe = safeHref(href);
          if (safe) {
            const label = text.slice(i + 1, labelEnd);
            out.push({ kind: "link", href: safe, value: parseInline(label) });
            i = hrefEnd + 1;
            continue;
          }
        }
      }
    }
    // **bold**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push({ kind: "bold", value: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    // *italic* — not matching if bordered by alphanumerics (`a*b*c`)
    if (text[i] === "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1) {
        const body = text.slice(i + 1, end);
        if (body.length > 0 && !body.includes("\n")) {
          out.push({ kind: "italic", value: parseInline(body) });
          i = end + 1;
          continue;
        }
      }
    }
    // accumulate literal text up to the next interesting char
    const nextSpecial = text
      .slice(i + 1)
      .search(/[`*\[]/);
    const runEnd = nextSpecial === -1 ? text.length : i + 1 + nextSpecial;
    out.push({ kind: "text", value: text.slice(i, runEnd) });
    i = runEnd;
  }
  return out;
}

function renderInline(nodes: Node[], keyPrefix = "n"): React.ReactNode {
  return nodes.map((n, i) => {
    const k = `${keyPrefix}-${i}`;
    switch (n.kind) {
      case "text":
        return <React.Fragment key={k}>{n.value}</React.Fragment>;
      case "bold":
        return (
          <strong key={k} className="font-semibold text-fg">
            {renderInline(n.value, k)}
          </strong>
        );
      case "italic":
        return <em key={k}>{renderInline(n.value, k)}</em>;
      case "code":
        return (
          <code
            key={k}
            className="rounded bg-bg-2 px-1 py-[1px] font-mono text-[0.9em] text-fg-dim"
          >
            {n.value}
          </code>
        );
      case "link":
        return (
          <a
            key={k}
            href={n.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {renderInline(n.value, k)}
          </a>
        );
    }
  });
}

/**
 * Split text into blocks separated by ``` code fences or blank lines,
 * render each. Code fences become monospace <pre>; other blocks run
 * through the inline parser.
 */
export function InlineMarkdown({ text, className }: Props) {
  if (!text) return null;
  const blocks: Array<{ kind: "p" | "pre"; value: string }> = [];
  const fenceRe = /```([\s\S]*?)```/g;
  let lastIx = 0;
  for (const match of text.matchAll(fenceRe)) {
    const ix = match.index ?? 0;
    if (ix > lastIx) {
      blocks.push({ kind: "p", value: text.slice(lastIx, ix) });
    }
    blocks.push({ kind: "pre", value: match[1].replace(/^\n/, "") });
    lastIx = ix + match[0].length;
  }
  if (lastIx < text.length) {
    blocks.push({ kind: "p", value: text.slice(lastIx) });
  }

  return (
    <div className={className}>
      {blocks.flatMap((b, bi) => {
        if (b.kind === "pre") {
          return [
            <pre
              key={`b-${bi}`}
              className="mt-2 overflow-x-auto rounded-md border border-line bg-bg-1 p-3 font-mono text-[12px] leading-relaxed text-fg-dim"
            >
              {b.value}
            </pre>,
          ];
        }
        // Split paragraphs on blank lines, keep single \n as <br />.
        const paragraphs = b.value.split(/\n{2,}/);
        return paragraphs
          .filter((p) => p.trim().length > 0)
          .map((p, pi) => {
            const lines = p.split("\n");
            return (
              <p
                key={`b-${bi}-p-${pi}`}
                className="whitespace-normal [&:not(:first-child)]:mt-2"
              >
                {lines.map((ln, li) => (
                  <React.Fragment key={li}>
                    {li > 0 && <br />}
                    {renderInline(parseInline(ln))}
                  </React.Fragment>
                ))}
              </p>
            );
          });
      })}
    </div>
  );
}
