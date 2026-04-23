"use client";
import { useState } from "react";
import type { ChatAction } from "@/lib/chat-types";

interface Props {
  actions: ChatAction[];
}

/**
 * Progressive disclosure: collapsed shows a single-line summary;
 * expanded shows one chip per action with result status; a further
 * expand on a chip reveals args JSON + full result summary.
 */
export function ActionChips({ actions }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!actions || actions.length === 0) return null;
  const okCount = actions.filter((a) => a.resultOk !== false).length;
  const hasErr = actions.some((a) => a.resultOk === false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute hover:text-fg transition-colors"
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
          className={`ml-1 inline-block h-1 w-1 rounded-full ${
            hasErr ? "bg-[--bad]" : "bg-accent"
          }`}
        />
        <span className="text-fg-mute/70">
          {okCount}/{actions.length}
        </span>
      </button>

      {open && (
        <ul className="mt-2 space-y-1 border-l border-line pl-3">
          {actions.map((a) => {
            const ok = a.resultOk !== false;
            const isOpen = expanded[a.id];
            return (
              <li key={a.id} className="text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((e) => ({ ...e, [a.id]: !e[a.id] }))
                  }
                  className="flex w-full items-start gap-2 text-left"
                >
                  <span
                    aria-hidden
                    className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      ok ? "bg-accent" : "bg-[--bad]"
                    }`}
                  />
                  <span className="flex-1">
                    <span className="font-mono text-fg-dim">{a.name}</span>
                    {a.resultSummary && (
                      <span className="font-sans text-fg-dim/80">
                        {" · "}
                        <span className="italic">{a.resultSummary}</span>
                      </span>
                    )}
                  </span>
                  <span
                    aria-hidden
                    className={`font-mono text-[9px] text-fg-mute transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  >
                    ▸
                  </span>
                </button>
                {isOpen && (
                  <pre className="mt-1 ml-3.5 overflow-x-auto rounded border border-line bg-bg-1 p-2 font-mono text-[10px] text-fg-dim">
                    {JSON.stringify(a.args ?? {}, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
