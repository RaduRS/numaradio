"use client";
import { useState } from "react";
import type { ChatConfirm } from "@/lib/chat-types";

interface Props {
  confirm: ChatConfirm;
  onResolve?: (decision: "approve" | "cancel") => void | Promise<void>;
}

/**
 * Yellow-light inline card the UI renders when the agent emits a
 * `<confirm …>prompt</confirm>` tag. The card's tactile, sticker-like
 * treatment (warm amber border, tiny serif label) is deliberately
 * distinct from everything else in the transcript so the operator's
 * eye goes to it.
 */
export function ConfirmCard({ confirm, onResolve }: Props) {
  const [busy, setBusy] = useState(false);
  const decided = !!confirm.decision;

  async function handle(decision: "approve" | "cancel") {
    if (busy || decided) return;
    setBusy(true);
    try {
      await onResolve?.(decision);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-3 rounded-md border border-[--warn]/70 bg-[--warn]/[0.06] px-4 py-3 shadow-[inset_0_1px_0_rgba(245,180,0,0.12)]"
      role="alertdialog"
      aria-label="Confirm action"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[--warn]">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-[--warn]"
        />
        Confirm action
        <span className="ml-auto font-sans text-fg-mute normal-case tracking-normal">
          {confirm.action}
        </span>
      </div>
      <p className="mt-2 font-sans text-sm text-fg">{confirm.prompt}</p>
      {Object.keys(confirm.args || {}).length > 0 && (
        <pre className="mt-2 overflow-x-auto rounded border border-line-strong bg-bg-1 p-2 font-mono text-[10px] text-fg-dim">
          {JSON.stringify(confirm.args, null, 2)}
        </pre>
      )}
      <div className="mt-3 flex items-center gap-2">
        {decided ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
            {confirm.decision === "approve" ? "✓ approved" : "× cancelled"}
            {confirm.decidedAt && (
              <span className="ml-2 text-fg-mute/60">
                {new Date(confirm.decidedAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => handle("approve")}
              className="rounded-md bg-[--warn] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-bg hover:brightness-110 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handle("cancel")}
              className="rounded-md border border-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-dim hover:border-fg-mute hover:text-fg disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
