"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatAction,
  ChatConfirm,
  ChatTurn,
  ConnectionState,
} from "@/lib/chat-types";
import { parseAgentReplyClient } from "@/lib/chat-tags";

interface UseChatStreamResult {
  turns: ChatTurn[];
  connection: ConnectionState;
  typing: boolean;
  pendingConfirm: ChatConfirm | null;
  sending: boolean;
  send: (text: string) => Promise<void>;
  resolveConfirm: (
    confirm: ChatConfirm,
    decision: "approve" | "cancel",
  ) => Promise<void>;
  clear: () => Promise<void>;
}

interface SseMessage {
  event: string;
  data: unknown;
}

/**
 * Parse a chunk of raw SSE bytes into complete events. SSE frames are
 * separated by a blank line ("\n\n"). We buffer partial frames until the
 * terminator arrives. Comments (": …") are ignored.
 */
function parseSseFrames(
  buffer: string,
): { events: SseMessage[]; rest: string } {
  const events: SseMessage[] = [];
  let rest = buffer;
  let ix = rest.indexOf("\n\n");
  while (ix !== -1) {
    const frame = rest.slice(0, ix);
    rest = rest.slice(ix + 2);
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length > 0) {
      let data: unknown = dataLines.join("\n");
      try {
        data = JSON.parse(data as string);
      } catch {
        // leave as string
      }
      events.push({ event: eventName, data });
    }
    ix = rest.indexOf("\n\n");
  }
  return { events, rest };
}

/**
 * Hook that owns the chat state machine. It:
 *   - backfills history from /api/chat/history on mount
 *   - opens a streamed fetch to /api/chat/stream and parses SSE frames
 *     (EventSource doesn't play nicely with Next route-handler pass-through
 *      in every browser when the upstream is chunked, so we use fetch+reader)
 *   - exposes send() / resolveConfirm() actions
 *   - auto-reconnects with exponential backoff on stream drop
 */
export function useChatStream(): UseChatStreamResult {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [typing, setTyping] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ChatConfirm | null>(
    null,
  );
  const [sending, setSending] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const backoffRef = useRef(1000);
  const openStreamRef = useRef<(() => void) | null>(null);

  // ── State helpers ────────────────────────────────────────────────────

  const upsertAssistantTurn = useCallback(
    (turnId: string, patch: Partial<ChatTurn>) => {
      setTurns((prev) => {
        const existing = prev.findIndex((t) => t.id === turnId);
        if (existing !== -1) {
          const next = prev.slice();
          next[existing] = { ...next[existing], ...patch };
          return next;
        }
        const created: ChatTurn = {
          id: turnId,
          role: "assistant",
          text: "",
          timestamp: new Date().toISOString(),
          streaming: true,
          actions: [],
          confirms: [],
          ...patch,
        };
        return [...prev, created];
      });
    },
    [],
  );

  const appendChunk = useCallback((turnId: string, chunk: string) => {
    setTurns((prev) => {
      const existing = prev.findIndex((t) => t.id === turnId);
      if (existing !== -1) {
        const next = prev.slice();
        next[existing] = {
          ...next[existing],
          text: (next[existing].text || "") + chunk,
          streaming: true,
        };
        return next;
      }
      return [
        ...prev,
        {
          id: turnId,
          role: "assistant",
          text: chunk,
          timestamp: new Date().toISOString(),
          streaming: true,
          actions: [],
          confirms: [],
        },
      ];
    });
  }, []);

  const appendAction = useCallback(
    (turnId: string, action: ChatAction) => {
      setTurns((prev) => {
        const ix = prev.findIndex((t) => t.id === turnId);
        if (ix === -1) {
          return [
            ...prev,
            {
              id: turnId,
              role: "assistant",
              text: "",
              timestamp: action.at,
              streaming: true,
              actions: [action],
              confirms: [],
            },
          ];
        }
        const next = prev.slice();
        next[ix] = {
          ...next[ix],
          actions: [...(next[ix].actions || []), action],
        };
        return next;
      });
    },
    [],
  );

  const patchActionResult = useCallback(
    (actionId: string, ok: boolean, summary?: string) => {
      setTurns((prev) =>
        prev.map((t) =>
          !t.actions
            ? t
            : {
                ...t,
                actions: t.actions.map((a) =>
                  a.id === actionId
                    ? { ...a, resultOk: ok, resultSummary: summary }
                    : a,
                ),
              },
        ),
      );
    },
    [],
  );

  // ── SSE ──────────────────────────────────────────────────────────────

  const openStream = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setConnection((c) => (c === "live" ? "reconnecting" : "connecting"));

    (async () => {
      try {
        const res = await fetch("/api/chat/stream", {
          signal: abort.signal,
          cache: "no-store",
          headers: { accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) {
          throw new Error(`stream upstream ${res.status}`);
        }
        setConnection("live");
        backoffRef.current = 1000;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          for (const ev of parsed.events) {
            handleEvent(ev);
          }
        }
        throw new Error("stream closed by upstream");
      } catch (err) {
        if (abort.signal.aborted) return;
        setConnection("reconnecting");
        const delay = Math.min(backoffRef.current, 15_000);
        backoffRef.current = Math.min(delay * 2, 15_000);
        reconnectRef.current = window.setTimeout(
          () => openStreamRef.current?.(),
          delay,
        );
      }
    })();

    function handleEvent(ev: SseMessage) {
      switch (ev.event) {
        case "typing": {
          setTyping(true);
          break;
        }
        case "message.chunk": {
          const d = ev.data as { turnId: string; text: string };
          if (d?.turnId && typeof d.text === "string") {
            appendChunk(d.turnId, d.text);
            setTyping(true);
          }
          break;
        }
        case "action": {
          const d = ev.data as {
            turnId: string;
            id: string;
            name: string;
            args: unknown;
            at: string;
          };
          if (d?.turnId) {
            appendAction(d.turnId, {
              id: d.id,
              name: d.name,
              args: d.args,
              at: d.at,
            });
          }
          break;
        }
        case "action.result": {
          const d = ev.data as {
            id: string;
            ok: boolean;
            summary?: string;
          };
          if (d?.id) patchActionResult(d.id, !!d.ok, d.summary);
          break;
        }
        case "confirm.request": {
          const d = ev.data as {
            turnId: string;
            confirmId: string;
            action: string;
            args: Record<string, unknown>;
            prompt: string;
          };
          if (d?.confirmId) {
            const c: ChatConfirm = {
              id: d.confirmId,
              action: d.action,
              args: d.args || {},
              prompt: d.prompt,
            };
            setPendingConfirm(c);
            upsertAssistantTurn(d.turnId, {
              confirms: [c],
            });
          }
          break;
        }
        case "confirm.resolved": {
          const d = ev.data as { confirmId: string; decision: string };
          setPendingConfirm((cur) =>
            cur && cur.id === d.confirmId ? null : cur,
          );
          setTurns((prev) =>
            prev.map((t) =>
              !t.confirms
                ? t
                : {
                    ...t,
                    confirms: t.confirms.map((c) =>
                      c.id === d.confirmId
                        ? {
                            ...c,
                            decision: d.decision as "approve" | "cancel",
                            decidedAt: new Date().toISOString(),
                          }
                        : c,
                    ),
                  },
            ),
          );
          break;
        }
        case "message.done": {
          const d = ev.data as { turnId: string };
          setTurns((prev) =>
            prev.map((t) =>
              t.id === d?.turnId ? { ...t, streaming: false } : t,
            ),
          );
          setTyping(false);
          break;
        }
        case "error": {
          const d = ev.data as { turnId?: string; message?: string };
          setTyping(false);
          setTurns((prev) => [
            ...prev,
            {
              id: `err_${Date.now()}`,
              role: "system",
              text: "",
              error: d?.message || "stream error",
              timestamp: new Date().toISOString(),
            },
          ]);
          break;
        }
        default:
          // ignore unknown events
          break;
      }
    }
  }, [appendAction, appendChunk, patchActionResult, upsertAssistantTurn]);

  useEffect(() => {
    openStreamRef.current = openStream;
  }, [openStream]);

  // ── Mount: backfill history + open stream ────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/history?limit=50", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`history ${res.status}`);
        const json = (await res.json()) as {
          ok: boolean;
          turns?: Array<{
            id: string;
            role: string;
            content: string;
            timestamp: string;
          }>;
        };
        if (cancelled) return;
        if (json.ok && json.turns) {
          setTurns(
            json.turns.map<ChatTurn>((t) => {
              const role = t.role === "assistant" ? "assistant" : "user";
              // Historical assistant turns were stored with <action/> and
              // <internal> tags inline. Parse them on the client so chips
              // render consistently with live turns.
              if (role === "assistant") {
                const parsed = parseAgentReplyClient(t.content);
                return {
                  id: t.id,
                  role,
                  text: parsed.plain,
                  timestamp: t.timestamp,
                  streaming: false,
                  actions: parsed.actions,
                };
              }
              return {
                id: t.id,
                role,
                text: t.content,
                timestamp: t.timestamp,
                streaming: false,
              };
            }),
          );
        }
      } catch {
        // silent — live stream will populate
      }
      if (!cancelled) openStream();
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };
  }, [openStream]);

  // ── Actions ──────────────────────────────────────────────────────────

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userTurn: ChatTurn = {
      id: `u_${Date.now()}`,
      role: "user",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);
    setSending(true);
    setTyping(true);
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setTurns((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: "system",
            text: "",
            error: `send failed (${res.status}): ${body.slice(0, 200)}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        setTyping(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network error";
      setTurns((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "system",
          text: "",
          error: `send failed: ${msg}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setTyping(false);
    } finally {
      setSending(false);
    }
  }, []);

  const resolveConfirm = useCallback(
    async (confirm: ChatConfirm, decision: "approve" | "cancel") => {
      setPendingConfirm(null);
      setTurns((prev) =>
        prev.map((t) =>
          !t.confirms
            ? t
            : {
                ...t,
                confirms: t.confirms.map((c) =>
                  c.id === confirm.id
                    ? { ...c, decision, decidedAt: new Date().toISOString() }
                    : c,
                ),
              },
        ),
      );
      try {
        await fetch(`/api/chat/confirm/${encodeURIComponent(confirm.id)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision,
            action: confirm.action,
            args: confirm.args,
          }),
        });
      } catch {
        // Audit loss here is acceptable — the injected system message in
        // NanoClaw is best-effort; the UI already shows the decision.
      }
    },
    [],
  );

  const clear = useCallback(async () => {
    // Optimistic: blank the local transcript immediately. The server call
    // writes a cutoff timestamp so reloads stay clear; memory is untouched.
    setTurns([]);
    setPendingConfirm(null);
    setTyping(false);
    try {
      await fetch("/api/chat/clear", { method: "POST" });
    } catch {
      // Non-fatal — the UI is already cleared; reload will revive history
      // if the server call didn't land.
    }
  }, []);

  return useMemo(
    () => ({
      turns,
      connection,
      typing,
      pendingConfirm,
      sending,
      send,
      resolveConfirm,
      clear,
    }),
    [
      turns,
      connection,
      typing,
      pendingConfirm,
      sending,
      send,
      resolveConfirm,
      clear,
    ],
  );
}
