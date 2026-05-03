"use client";
import { useEffect, useState } from "react";
import { MegaphoneIcon, SparklesIcon, SendIcon, LoadingIcon } from "./Icons";
import { SongTab } from "./SongTab";
import {
  clearShoutoutStash,
  isFresh,
  readShoutoutStash,
  SHOUTOUT_STASH_MAX_AGE_MS,
  writeShoutoutStash,
} from "@/lib/booth-stash";

type Tab = "song" | "shout";
type StatusTone = "none" | "success" | "pending" | "error";

const REVIEW_LINES = [
  "Requests are reviewed live on air — Lena picks what fits the moment.",
  "Anything unsafe gets quietly dropped — we keep the station clean.",
  "Not every submission is guaranteed to play.",
];

export function RequestForm({
  initialTab = "song",
  tab: controlledTab,
  onTabChange,
}: {
  initialTab?: Tab;
  // When `tab` + `onTabChange` are passed, the form is controlled (parent owns
  // the sub-tab state). Otherwise it falls back to internal state seeded from
  // `initialTab`.
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
}) {
  const [internalTab, setInternalTab] = useState<Tab>(initialTab);
  const tab = controlledTab ?? internalTab;
  const setTab = (next: Tab) => {
    if (onTabChange) onTabChange(next);
    else setInternalTab(next);
  };
  const [reviewIdx, setReviewIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendLabel, setSendLabel] = useState("Send to the booth");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("none");
  const [formKey, setFormKey] = useState(0);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [whoError, setWhoError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(
      () => setReviewIdx((i) => (i + 1) % REVIEW_LINES.length),
      4_200,
    );
    return () => clearInterval(id);
  }, []);

  // Focus-time recovery: if the last optimistic submit's background pipeline
  // failed (rare but possible since we no longer await TTS/B2/queue push),
  // surface a one-time line and clear the stash.
  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      const stash = readShoutoutStash();
      if (!stash) return;
      if (!isFresh(stash.submittedAt, SHOUTOUT_STASH_MAX_AGE_MS)) {
        clearShoutoutStash();
        return;
      }
      try {
        const res = await fetch(
          `/api/booth/shoutout/${stash.shoutoutId}/status`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (!res.ok) {
          // 404 (row gone) or 5xx — give up, don't nag the user about it
          clearShoutoutStash();
          return;
        }
        const data = (await res.json()) as { ok?: boolean; status?: string };
        if (cancelled || !data.ok) return;
        if (data.status === "failed") {
          setRecoveryMessage(
            "Heads up — your last shoutout didn't make it on air. Try again.",
          );
          clearShoutoutStash();
        } else if (
          data.status === "aired" ||
          data.status === "blocked" ||
          data.status === "held"
        ) {
          // terminal state — clear quietly, no user notification needed
          clearShoutoutStash();
        }
        // else "pending" — leave stash; we'll re-check next focus
      } catch {
        // network down — try again on next focus
      }
    };
    void check();
    const onFocus = (): void => {
      void check();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatusMessage("");
    setStatusTone("none");
    setWhoError(null);
    setMessageError(null);

    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const who = String(form.get("who") ?? "").trim();
    const requesterName = String(form.get("requesterName") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();

    let firstInvalid: HTMLElement | null = null;
    if (who.length < 2) {
      setWhoError(
        who.length === 0
          ? "Who's this for? Give Lena a name."
          : "A little longer — at least two characters.",
      );
      firstInvalid =
        firstInvalid ?? formEl.querySelector<HTMLInputElement>('input[name="who"]');
    }
    if (message.length < 4) {
      setMessageError(
        message.length === 0
          ? "Add a short message for Lena to read."
          : "A little longer — at least a few words.",
      );
      firstInvalid =
        firstInvalid ??
        formEl.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const parts: string[] = [];
    if (who) parts.push(`This one's going out to ${who}.`);
    parts.push(message);
    const text = parts.join(" ").trim();

    setSending(true);
    setSendLabel("Sending…");

    try {
      const res = await fetch("/api/booth/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, requesterName: requesterName || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        message?: string;
        error?: string;
        shoutoutId?: string;
      };
      if (res.ok && data.ok && data.status === "moderating" && data.shoutoutId) {
        // The submit route returns 200 immediately; moderation runs in
        // after() so we don't burn Vercel CPU waiting on MiniMax. Show
        // a "checking…" pending state, then poll for the terminal
        // outcome (queued/held/blocked/failed) over the next few
        // seconds. Stash the id so a focus-time recovery on a later
        // visit can also catch silent failures.
        setStatusTone("pending");
        setStatusMessage(
          data.message ?? "Got it. Just giving it a quick look…",
        );
        setSendLabel("Reviewing…");
        setFormKey((k) => k + 1);
        setRecoveryMessage(null);
        writeShoutoutStash(data.shoutoutId);
        await pollModerationOutcome(data.shoutoutId);
      } else if (data.status === "blocked") {
        setStatusTone("error");
        setStatusMessage(data.message ?? "That one can't go on air.");
        setSendLabel("Send to the booth");
      } else {
        setStatusTone("error");
        setStatusMessage(data.error ?? data.message ?? "Couldn't send — try again.");
        setSendLabel("Send to the booth");
      }
    } catch {
      setStatusTone("error");
      setStatusMessage("Network hiccup — try again in a moment.");
      setSendLabel("Send to the booth");
    } finally {
      setSending(false);
      setTimeout(() => {
        setSendLabel((label) => (label.startsWith("✓") ? "Send another" : label));
      }, 2_000);
    }
  }

  // Poll /status until moderation lands on a terminal state, then update
  // the spinner copy. Bounded — gives up after MAX_TRIES so a stuck
  // pipeline can't leave the spinner spinning forever; the focus-time
  // recovery on a later visit is the safety net.
  async function pollModerationOutcome(shoutoutId: string): Promise<void> {
    const MAX_TRIES = 20; // 20 × ~1s ≈ 20s budget
    const FIRST_DELAY_MS = 600;
    const STEP_MS = 1_000;
    for (let i = 0; i < MAX_TRIES; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? FIRST_DELAY_MS : STEP_MS));
      let res: Response;
      try {
        res = await fetch(`/api/booth/shoutout/${shoutoutId}/status`, {
          cache: "no-store",
        });
      } catch {
        continue; // network blip — try again
      }
      if (!res.ok) continue;
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; status?: string }
        | null;
      if (!json?.ok) continue;
      const s = json.status;
      // "moderating" = still running. Any other state is terminal-ish.
      if (s === "moderating") continue;
      if (s === "pending" || s === "aired") {
        setStatusTone("success");
        setStatusMessage("Got it. It's on its way to air.");
        setSendLabel("✓ Sent");
        return;
      }
      if (s === "held") {
        setStatusTone("pending");
        setStatusMessage("Got it. A moderator's giving it a quick look.");
        setSendLabel("✓ Received");
        return;
      }
      if (s === "blocked") {
        setStatusTone("error");
        setStatusMessage("That one can't go on air.");
        setSendLabel("Send to the booth");
        clearShoutoutStash();
        return;
      }
      if (s === "failed") {
        setStatusTone("error");
        setStatusMessage(
          "Couldn't send that one — try again in a minute.",
        );
        setSendLabel("Send to the booth");
        clearShoutoutStash();
        return;
      }
    }
    // Timed out — show a soft "we're checking" so the user isn't stuck
    // staring at a spinner. The focus-time recovery in the useEffect
    // above will catch the final state on next visit.
    setStatusTone("pending");
    setStatusMessage(
      "Still working on that — we'll catch up next time you visit.",
    );
    setSendLabel("✓ Sent");
  }

  return (
    <>
      {recoveryMessage ? (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            border: "1px solid var(--line)",
            borderRadius: 10,
            background: "color-mix(in oklab, var(--line) 30%, transparent)",
            fontSize: 13,
            color: "var(--fg-mute)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>{recoveryMessage}</span>
          <button
            type="button"
            onClick={() => setRecoveryMessage(null)}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--fg-mute)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 4px",
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="req-types" role="tablist" aria-label="Request type">
        <button
          id="req-tab-song"
          className={`req-type ${tab === "song" ? "active" : ""}`}
          onClick={() => setTab("song")}
          role="tab"
          aria-selected={tab === "song"}
          aria-controls="req-panel-song"
          tabIndex={tab === "song" ? 0 : -1}
        >
          <span className="rt-ico"><SparklesIcon className="" /></span>
          <span className="rt-label">Song request</span>
        </button>
        <button
          id="req-tab-shout"
          className={`req-type ${tab === "shout" ? "active" : ""}`}
          onClick={() => setTab("shout")}
          role="tab"
          aria-selected={tab === "shout"}
          aria-controls="req-panel-shout"
          tabIndex={tab === "shout" ? 0 : -1}
        >
          <span className="rt-ico"><MegaphoneIcon className="" /></span>
          <span className="rt-label">Shoutout</span>
        </button>
      </div>
      {tab === "song" ? (
        <div role="tabpanel" id="req-panel-song" aria-labelledby="req-tab-song">
          <SongTab />
        </div>
      ) : (
        <form
          onSubmit={submit}
          key={formKey}
          noValidate
          role="tabpanel"
          id="req-panel-shout"
          aria-labelledby="req-tab-shout"
        >
          <div className="req-input-group">
            <input
              name="who"
              className={`req-input${whoError ? " invalid" : ""}`}
              placeholder="Who it's for…"
              maxLength={60}
              required
              aria-invalid={whoError ? "true" : undefined}
              aria-describedby={whoError ? "shoutout-who-error" : undefined}
              onChange={() => {
                if (whoError) setWhoError(null);
              }}
            />
            {whoError ? (
              <div
                id="shoutout-who-error"
                className="req-field-error"
                role="alert"
              >
                {whoError}
              </div>
            ) : null}
            <input name="requesterName" className="req-input" placeholder="Your name or city (optional)" maxLength={60} />
            <textarea
              name="message"
              className={`req-input req-textarea${messageError ? " invalid" : ""}`}
              placeholder="Your message — keep it short so we get through more."
              maxLength={220}
              required
              aria-invalid={messageError ? "true" : undefined}
              aria-describedby={messageError ? "shoutout-message-error" : undefined}
              onChange={() => {
                if (messageError) setMessageError(null);
              }}
            />
            {messageError ? (
              <div
                id="shoutout-message-error"
                className="req-field-error"
                role="alert"
              >
                {messageError}
              </div>
            ) : null}
          </div>
          <button type="submit" className="btn btn-primary req-send" disabled={sending} aria-busy={sending}>
            <span>{sendLabel}</span>
            {sending ? <LoadingIcon className="btn-icon" /> : <SendIcon className="btn-icon" />}
          </button>
          {statusTone !== "none" && (
            <div
              role="status"
              style={{
                marginTop: 12,
                fontSize: 13,
                color:
                  statusTone === "success"
                    ? "var(--accent)"
                    : statusTone === "error"
                      ? "#e85a4f"
                      : "var(--fg-mute)",
              }}
            >
              {statusMessage}
            </div>
          )}
        </form>
      )}
      <div className="req-review">
        <div className="rev-rotator">
          {REVIEW_LINES.map((line, i) => (
            <div key={i} className={`rev-line ${i === reviewIdx ? "active" : ""}`}>
              <span className={`dot ${i === 0 ? "" : "soft"}`} />
              <span>{line}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
