"use client";
import type { ChatConfirm, ChatTurn as TurnT } from "@/lib/chat-types";
import { ActionChips } from "./action-chips";
import { ConfirmCard } from "./confirm-card";
import { InlineMarkdown } from "./inline-markdown";

interface Props {
  turn: TurnT;
  onResolveConfirm?: (
    confirm: ChatConfirm,
    decision: "approve" | "cancel",
  ) => void | Promise<void>;
}

/**
 * Renders a single transcript row. Operator turns are right-aligned,
 * monospace, with a terminal-prompt `>` prefix and a thin accent rule.
 * Producer turns are left-aligned Inter Tight body with a warm rule,
 * and carry their action chips and confirm cards below.
 *
 * System rows (errors and confirm resolutions injected by the proxy)
 * render as a small centered monospace line so they read as "console
 * output" rather than participant speech.
 */
export function ChatTurn({ turn, onResolveConfirm }: Props) {
  const time = new Date(turn.timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (turn.role === "system") {
    return (
      <div className="my-4 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
        <span className="h-px flex-1 bg-line" />
        <span className={turn.error ? "text-[--bad]" : ""}>
          {turn.error || turn.text}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }

  if (turn.role === "user") {
    return (
      <div className="group flex flex-col items-end">
        <div className="max-w-[85%] rounded-l-md rounded-tr-md border border-line-strong bg-bg-2 px-4 py-2.5 font-mono text-[13px] text-fg shadow-[0_1px_0_rgba(255,255,255,0.02)]">
          <span className="text-accent/60">&gt;&nbsp;</span>
          <span className="whitespace-pre-wrap break-words">{turn.text}</span>
        </div>
        <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-fg-mute">
          operator · {time}
        </span>
      </div>
    );
  }

  // assistant
  return (
    <div className="group relative pl-4">
      <span
        aria-hidden
        className="absolute left-0 top-2 bottom-2 w-px bg-[--warm]/40"
      />
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[--warm]/80">
          Lena&rsquo;s producer
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-mute">
          {time}
        </span>
        {turn.streaming && (
          <span
            aria-hidden
            className="inline-flex items-end gap-[3px] pb-[2px]"
            role="status"
            aria-label="streaming"
          >
            <span className="numa-typing-dot inline-block h-[5px] w-[5px] rounded-full bg-[--warm] [animation-delay:0ms]" />
            <span className="numa-typing-dot inline-block h-[5px] w-[5px] rounded-full bg-[--warm] [animation-delay:180ms]" />
            <span className="numa-typing-dot inline-block h-[5px] w-[5px] rounded-full bg-[--warm] [animation-delay:360ms]" />
          </span>
        )}
      </div>
      {turn.text && (
        <InlineMarkdown
          text={turn.text}
          className="mt-1 text-[15px] leading-relaxed text-fg"
        />
      )}
      {turn.actions && turn.actions.length > 0 && (
        <ActionChips actions={turn.actions} />
      )}
      {turn.confirms?.map((c) => (
        <ConfirmCard
          key={c.id}
          confirm={c}
          onResolve={(d) => onResolveConfirm?.(c, d)}
        />
      ))}
    </div>
  );
}
