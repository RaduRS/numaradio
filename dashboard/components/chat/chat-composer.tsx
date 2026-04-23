"use client";
import { useRef, useState, useEffect, useCallback } from "react";

interface Props {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void | Promise<void>;
}

/**
 * Auto-growing textarea with a terminal-style prompt glyph, Cmd/Ctrl+Enter
 * to send. Lives at the bottom of the transcript pane, grows up to ~8
 * lines and then scrolls internally.
 */
export function ChatComposer({ disabled, placeholder, onSend }: Props) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const autosize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 8 * 22; // ~8 lines at our body size
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, []);

  useEffect(autosize, [value, autosize]);

  async function submit() {
    if (!value.trim() || disabled) return;
    const text = value;
    setValue("");
    await onSend(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends. Shift+Enter inserts a newline.
    // Cmd/Ctrl+Enter is also accepted for muscle-memory compatibility.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="relative mt-2 rounded-xl border border-line bg-bg-1/80 px-4 py-3 backdrop-blur-sm"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-2.5 font-mono text-xs text-accent select-none"
        >
          &gt;
        </span>
        <textarea
          ref={taRef}
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            placeholder ??
            "Ask anything. Push tracks. Make Lena say something."
          }
          className="block w-full resize-none bg-transparent font-sans text-[15px] leading-[1.5] text-fg placeholder:text-fg-mute focus:outline-none disabled:opacity-50"
          aria-label="Message Lena's producer"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-bg transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          Send
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.22em] text-fg-mute/70">
        <span>Enter to send · Shift+Enter for newline</span>
        {disabled && <span className="text-[--warn]">awaiting confirm…</span>}
      </div>
    </form>
  );
}
