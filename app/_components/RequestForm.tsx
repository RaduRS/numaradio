"use client";
import { useEffect, useState } from "react";
import { MegaphoneIcon, SparklesIcon, SendIcon, LoadingIcon } from "./Icons";
import { SongTab } from "./SongTab";

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

  useEffect(() => {
    const id = setInterval(
      () => setReviewIdx((i) => (i + 1) % REVIEW_LINES.length),
      4_200,
    );
    return () => clearInterval(id);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatusMessage("");
    setStatusTone("none");

    const form = new FormData(e.currentTarget);
    const who = String(form.get("who") ?? "").trim();
    const requesterName = String(form.get("requesterName") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();

    const parts: string[] = [];
    if (who) parts.push(`This one's going out to ${who}.`);
    if (message) parts.push(message);
    const text = parts.join(" ").trim();

    if (text.length < 4) {
      setStatusTone("error");
      setStatusMessage("Add a short message for Lena to read.");
      return;
    }

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
      };
      if (res.ok && data.ok && data.status === "queued") {
        setStatusTone("success");
        setStatusMessage(data.message ?? "Shoutout queued — Lena will read it next.");
        setSendLabel("✓ In the queue");
        setFormKey((k) => k + 1);
      } else if (res.ok && data.status === "held") {
        setStatusTone("pending");
        setStatusMessage(data.message ?? "Waiting on a moderator.");
        setSendLabel("✓ Received");
        setFormKey((k) => k + 1);
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

  return (
    <>
      <div className="req-types" role="tablist">
        <button
          className={`req-type ${tab === "song" ? "active" : ""}`}
          onClick={() => setTab("song")}
          role="tab"
          aria-selected={tab === "song"}
        >
          <span className="rt-ico"><SparklesIcon className="" /></span>
          <span className="rt-label">Song request</span>
        </button>
        <button
          className={`req-type ${tab === "shout" ? "active" : ""}`}
          onClick={() => setTab("shout")}
          role="tab"
          aria-selected={tab === "shout"}
        >
          <span className="rt-ico"><MegaphoneIcon className="" /></span>
          <span className="rt-label">Shoutout</span>
        </button>
      </div>
      {tab === "song" ? (
        <SongTab />
      ) : (
        <form onSubmit={submit} key={formKey}>
          <div className="req-input-group">
            <input name="who" className="req-input" placeholder="Who it's for…" maxLength={60} />
            <input name="requesterName" className="req-input" placeholder="Your name or city" maxLength={60} />
            <textarea
              name="message"
              className="req-input req-textarea"
              placeholder="Your message — keep it short so we get through more."
              maxLength={220}
              required
            />
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
