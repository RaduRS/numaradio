"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useChatStream } from "@/hooks/use-chat-stream";
import { ChatTurn } from "@/components/chat/chat-turn";
import { ChatComposer } from "@/components/chat/chat-composer";
import { usePolling } from "@/hooks/use-polling";

interface NowPlayingResponse {
  ok: boolean;
  nowPlaying?: {
    title: string;
    artist: string | null;
  } | null;
}

/**
 * Dashboard → Lena's producer.
 *
 * One persistent conversation (`dashboard:main` group on the NanoClaw
 * side). Messages stream in via SSE; operator messages are sent over
 * a plain POST. The visual language leans into the radio-control-room
 * motif — monospace for operator commands, Inter Tight for Lena's
 * producer, warm amber for yellow-light confirmations.
 */
export default function ChatPage() {
  const {
    turns,
    connection,
    typing,
    pendingConfirm,
    sending,
    send,
    resolveConfirm,
    clear,
  } = useChatStream();

  // Tiny "what's on air right now" ticker beneath the page title.
  // Read-only; updates every 10s via the public now-playing route the
  // rest of the dashboard already uses.
  const nowPlaying = usePolling<NowPlayingResponse>(
    "/api/status",
    10_000,
  );
  // /api/status returns a richer blob; we duck-type for a nowPlaying field,
  // falling back to nothing if it's shaped differently on this deploy.
  const onAir = useMemo(() => {
    const d = nowPlaying.data as unknown as {
      nowPlaying?: { title?: string; artist?: string | null };
    } | null;
    const np = d?.nowPlaying;
    if (!np?.title) return null;
    return np.artist ? `${np.title} — ${np.artist}` : np.title;
  }, [nowPlaying.data]);

  // Keep the transcript scrolled to the latest message as new turns
  // arrive. We scroll the container, not the window, so the composer
  // stays anchored.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns.length, typing]);

  const composerDisabled = sending || pendingConfirm !== null;

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col px-6 pb-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="pt-8 pb-4">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="font-display text-2xl font-extrabold uppercase tracking-wide"
            style={{ fontStretch: "125%" }}
          >
            Numa<span className="text-accent">·</span>Radio
          </Link>
          <nav className="flex items-center gap-4 font-mono text-xs uppercase tracking-[0.2em]">
            <Link href="/" className="text-fg-mute hover:text-fg">
              ← back
            </Link>
            <Link href="/library" className="text-fg-mute hover:text-fg">
              library
            </Link>
            <Link href="/shoutouts" className="text-fg-mute hover:text-fg">
              shoutouts
            </Link>
          </nav>
        </div>

        <div className="mt-6 flex items-baseline justify-between gap-6 border-b border-line pb-3">
          <div>
            <h1
              className="font-display text-[40px] font-extrabold uppercase leading-none text-fg"
              style={{ fontStretch: "115%" }}
            >
              Talkback
            </h1>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-fg-mute">
              Direct line · Lena&rsquo;s producer
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (turns.length === 0) return;
                  if (
                    confirm(
                      "Clear transcript? Memory is preserved — Lena's producer will still remember everything.",
                    )
                  ) {
                    void clear();
                  }
                }}
                disabled={turns.length === 0}
                className="rounded-full border border-line-strong bg-bg-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute transition hover:border-fg-mute hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                title="Clear transcript (memory is preserved)"
              >
                Clear
              </button>
              <ConnectionPill state={connection} typing={typing} />
            </div>
            {onAir && (
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
                On air ·{" "}
                <span className="text-fg-dim normal-case tracking-normal font-sans">
                  {onAir}
                </span>
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Transcript ─────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex flex-col gap-6 py-6">
          {turns.length === 0 && connection === "live" && (
            <EmptyState />
          )}
          {turns.length === 0 && connection !== "live" && (
            <LoadingState />
          )}
          {turns.map((t) => (
            <ChatTurn
              key={t.id}
              turn={t}
              onResolveConfirm={(c, d) => resolveConfirm(c, d)}
            />
          ))}
          {typing && turns[turns.length - 1]?.role !== "assistant" && (
            <TypingRow />
          )}
        </div>
      </div>

      {/* ── Composer ──────────────────────────────────────────── */}
      <ChatComposer
        disabled={composerDisabled}
        placeholder={
          pendingConfirm
            ? "Resolve the confirm card above first…"
            : undefined
        }
        onSend={send}
        onSlashCommand={async (cmd) => {
          if (cmd === "clear" || cmd === "cls") {
            await clear();
            return true;
          }
          return false;
        }}
      />
    </main>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function ConnectionPill({
  state,
  typing,
}: {
  state: ReturnType<typeof useChatStream>["connection"];
  typing: boolean;
}) {
  const { label, dotClass, animate } = pillFor(state, typing);
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-bg-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim">
      <span className={`relative inline-flex h-1.5 w-1.5`}>
        <span
          className={`absolute inset-0 rounded-full ${dotClass}`}
          aria-hidden
        />
        {animate && (
          <span
            className={`absolute inset-0 animate-ping rounded-full ${dotClass} opacity-75`}
            aria-hidden
          />
        )}
      </span>
      {label}
    </span>
  );
}

function pillFor(
  state: ReturnType<typeof useChatStream>["connection"],
  typing: boolean,
): { label: string; dotClass: string; animate: boolean } {
  if (state === "live" && typing)
    return { label: "On air", dotClass: "bg-[--red-live]", animate: true };
  if (state === "live")
    return { label: "Connected", dotClass: "bg-accent", animate: false };
  if (state === "connecting")
    return { label: "Dialling", dotClass: "bg-[--warn]", animate: true };
  if (state === "reconnecting")
    return { label: "Reconnecting", dotClass: "bg-[--warn]", animate: true };
  if (state === "offline")
    return { label: "Offline", dotClass: "bg-[--bad]", animate: false };
  return { label: "Idle", dotClass: "bg-fg-mute", animate: false };
}

function EmptyState() {
  return (
    <div className="mt-10 flex flex-col items-center text-center">
      <div
        className="font-display text-[56px] font-extrabold uppercase leading-none text-fg-mute/40"
        style={{ fontStretch: "160%" }}
        aria-hidden
      >
        ON&nbsp;AIR
      </div>
      <p className="mt-4 max-w-sm font-sans text-sm text-fg-dim">
        Ask what&rsquo;s playing. Push a track. Tell her to make a song.
        Or just talk.
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute/70">
        She remembers everything you told her on Telegram.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mt-10 flex flex-col items-center">
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fg-mute">
        Patching through…
      </span>
    </div>
  );
}

function TypingRow() {
  return (
    <div className="relative pl-4">
      <span
        aria-hidden
        className="absolute left-0 top-2 bottom-2 w-px animate-pulse bg-[--warm]"
      />
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[--warm]/80">
          Lena&rsquo;s producer
        </span>
        <span
          aria-hidden
          className="inline-flex items-end gap-[3px] pb-[2px]"
          role="status"
          aria-label="Lena’s producer is thinking"
        >
          <span className="numa-typing-dot inline-block h-[7px] w-[7px] rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] [animation-delay:0ms]" />
          <span className="numa-typing-dot inline-block h-[7px] w-[7px] rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] [animation-delay:180ms]" />
          <span className="numa-typing-dot inline-block h-[7px] w-[7px] rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] [animation-delay:360ms]" />
        </span>
      </div>
    </div>
  );
}
