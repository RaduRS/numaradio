"use client";
import { useState } from "react";
import type { ChatAction } from "@/lib/chat-types";

interface Props {
  actions: ChatAction[];
}

// Tool responses come from in-process server code so they shouldn't
// contain control characters today, but a future tool that streams
// back e.g. journalctl output could pick up ANSI escapes or U+0000.
// React already escapes the string for HTML; we additionally strip
// non-printables so a stray \x1B[31m can't render as anything weird.
function sanitizeSummary(s: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\x00-\x1F\x7F]/g, "");
  return cleaned.length > 48 ? cleaned.slice(0, 47) + "…" : cleaned;
}

/**
 * Compact pills. Collapsed (default): one summary line with count.
 * Expanded: one pill per action — `name · result` — and nothing else.
 * No JSON args expansion. This is a chat transcript, not a debugger;
 * if the operator needs args, the dashboard logs have them.
 */
export function ActionChips({ actions }: Props) {
  const [open, setOpen] = useState(false);
  if (!actions || actions.length === 0) return null;
  const hasErr = actions.some((a) => a.resultOk === false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute transition-colors hover:text-fg"
      >
        <span
          aria-hidden
          className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span>
          {actions.length} action{actions.length === 1 ? "" : "s"}
        </span>
        <span
          aria-hidden
          className={`ml-0.5 inline-block h-1 w-1 rounded-full ${
            hasErr ? "bg-[--bad]" : "bg-accent"
          }`}
        />
      </button>

      {open && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {actions.map((a) => {
            const ok = a.resultOk !== false;
            return (
              <li key={a.id}>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${
                    ok
                      ? "border-line-strong bg-bg-2 text-fg-dim"
                      : "border-[--bad]/50 bg-[--bad]/[0.08] text-[--bad]"
                  }`}
                  title={a.resultSummary}
                >
                  <span
                    aria-hidden
                    className={`inline-block h-1 w-1 shrink-0 rounded-full ${
                      ok ? "bg-accent" : "bg-[--bad]"
                    }`}
                  />
                  <span className="font-mono text-fg-dim">{a.name}</span>
                  {a.resultSummary && (
                    <>
                      <span className="text-fg-mute/50">·</span>
                      <span className="font-sans italic">
                        {sanitizeSummary(a.resultSummary)}
                      </span>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
