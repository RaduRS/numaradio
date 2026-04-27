"use client";

import { useState, type FormEvent, type ChangeEvent } from "react";

type State =
  | { kind: "input" }
  | { kind: "submitting" }
  | { kind: "ok"; email: string }
  | { kind: "error"; message: string };

const MAX_AUDIO_MB = 10;
const MAX_ART_MB = 2;

export function SubmitForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [artwork, setArtwork] = useState<File | null>(null);
  const [airingPreference, setAiringPreference] = useState<"one_off" | "permanent">("one_off");
  const [vouched, setVouched] = useState(false);
  const [state, setState] = useState<State>({ kind: "input" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 80) {
      errs.name = "Between 2 and 80 characters.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = "Enter a valid email address.";
    }
    if (!audio) {
      errs.audio = "Pick an MP3 file.";
    } else if (audio.size > MAX_AUDIO_MB * 1024 * 1024) {
      errs.audio = `MP3 must be ${MAX_AUDIO_MB} MB or smaller.`;
    }
    if (artwork && artwork.size > MAX_ART_MB * 1024 * 1024) {
      errs.artwork = `Artwork must be ${MAX_ART_MB} MB or smaller.`;
    }
    if (!vouched) {
      errs.vouched = "Tick the confirmation box to submit.";
    }
    return errs;
  }

  const errs = validate();
  const canSubmit = Object.keys(errs).length === 0 && state.kind === "input";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    setFieldErrors(v);
    if (Object.keys(v).length > 0) return;
    setState({ kind: "submitting" });

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("email", email.trim());
    fd.append("vouched", "true");
    fd.append("airingPreference", airingPreference);
    if (audio) fd.append("audio", audio);
    if (artwork) fd.append("artwork", artwork);

    try {
      const res = await fetch("/api/submissions", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) {
        setState({ kind: "error", message: json.message ?? `Submission failed (HTTP ${res.status}).` });
        return;
      }
      setState({ kind: "ok", email: email.trim() });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.kind === "ok") {
    return (
      <div
        style={{
          padding: "28px 28px",
          border: "1px solid var(--line)",
          borderRadius: 12,
          background: "var(--bg-1)",
          maxWidth: 620,
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 12, color: "var(--accent)" }}>
          Got it
        </div>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: "var(--fg)", marginBottom: 8 }}>
          Lena will listen and you&apos;ll hear back at <strong>{state.email}</strong>.
        </p>
        <p style={{ fontSize: 13, color: "var(--fg-mute)", lineHeight: 1.55 }}>
          One submission per email at a time. Want to withdraw later? Email{" "}
          <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
            hello@numaradio.com
          </a>
          .
        </p>
      </div>
    );
  }

  const inputCls = "w-full bg-bg border rounded px-3.5 py-2.5 text-sm outline-none focus:border-accent transition-colors";
  const errorCls = "text-xs mt-1.5";

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "24px 24px 28px",
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--bg-1)",
        maxWidth: 620,
      }}
      noValidate
    >
      {/* Name */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>Your name</span>
        <input
          type="text"
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="As we should credit you on air"
          className={inputCls}
          style={{ borderColor: fieldErrors.name ? "var(--bad)" : "var(--line)" }}
        />
        {fieldErrors.name && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.name}</span>}
      </label>

      {/* Email */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>Email</span>
        <input
          type="email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          placeholder="Where we'll write back yes / no"
          className={inputCls}
          style={{ borderColor: fieldErrors.email ? "var(--bad)" : "var(--line)" }}
        />
        {fieldErrors.email && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.email}</span>}
      </label>

      {/* Audio */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>MP3 file (max {MAX_AUDIO_MB} MB)</span>
        <input
          type="file"
          accept="audio/mpeg,.mp3"
          onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {fieldErrors.audio && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.audio}</span>}
      </label>

      {/* Artwork */}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="caption-sm" style={{ color: "var(--fg-mute)" }}>
          Album art (optional, PNG or JPEG, max {MAX_ART_MB} MB)
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          onChange={(e) => setArtwork(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <span className={errorCls} style={{ color: "var(--fg-dim)" }}>
          If you skip this we&apos;ll use the cover embedded in your MP3, or generate one.
        </span>
        {fieldErrors.artwork && <span className={errorCls} style={{ color: "var(--bad)" }}>{fieldErrors.artwork}</span>}
      </label>

      {/* Airing preference */}
      <fieldset style={{ display: "flex", flexDirection: "column", gap: 8, border: 0, padding: 0 }}>
        <legend className="caption-sm" style={{ color: "var(--fg-mute)", marginBottom: 4 }}>
          How should we air it?
        </legend>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input
            type="radio"
            name="airing"
            checked={airingPreference === "one_off"}
            onChange={() => setAiringPreference("one_off")}
            style={{ marginTop: 4 }}
            title="We air this once. After that it's not in rotation."
          />
          <span>
            <span style={{ color: "var(--fg)", fontSize: 14, fontWeight: 500 }}>One-off airing</span>
            <span style={{ color: "var(--fg-mute)", fontSize: 12, display: "block" }}>
              We air this once. After that it&apos;s not in rotation.
            </span>
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input
            type="radio"
            name="airing"
            checked={airingPreference === "permanent"}
            onChange={() => setAiringPreference("permanent")}
            style={{ marginTop: 4 }}
            title="We add this to our regular library. Plays on rotation indefinitely."
          />
          <span>
            <span style={{ color: "var(--fg)", fontSize: 14, fontWeight: 500 }}>Permanent rotation</span>
            <span style={{ color: "var(--fg-mute)", fontSize: 12, display: "block" }}>
              We add this to our regular library. Plays on rotation indefinitely.
            </span>
          </span>
        </label>
      </fieldset>

      {/* Vouch */}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "14px 14px",
          border: `1px ${fieldErrors.vouched ? "solid var(--bad)" : "dashed var(--line-strong)"}`,
          borderRadius: 8,
          background: "rgba(255,77,77,0.03)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={vouched}
          onChange={(e) => setVouched(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span style={{ fontSize: 13, color: "var(--fg-dim)", lineHeight: 1.5 }}>
          I confirm this is my own work or I have all rights to it, and I&apos;m authorising
          Numa Radio to broadcast it. I understand I can withdraw it any time by emailing{" "}
          <a href="mailto:hello@numaradio.com" style={{ color: "var(--accent)" }}>
            hello@numaradio.com
          </a>
          . I&apos;ve read the{" "}
          <a href="/privacy#submissions" style={{ color: "var(--accent)" }}>
            terms
          </a>
          .
        </span>
      </label>
      {fieldErrors.vouched && (
        <span className={errorCls} style={{ color: "var(--bad)", marginTop: -10 }}>
          {fieldErrors.vouched}
        </span>
      )}

      {/* Error from server */}
      {state.kind === "error" && (
        <div
          style={{
            padding: "10px 14px",
            border: "1px solid var(--bad)",
            borderRadius: 8,
            background: "rgba(255,77,77,0.06)",
            color: "var(--bad)",
            fontSize: 13,
          }}
        >
          ✗ {state.message}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          padding: "14px 22px",
          fontSize: 14,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 500,
          border: "1px solid var(--accent)",
          color: canSubmit ? "var(--accent)" : "var(--fg-mute)",
          background: "transparent",
          borderRadius: 6,
          cursor: canSubmit ? "pointer" : "not-allowed",
          opacity: canSubmit ? 1 : 0.5,
          alignSelf: "flex-start",
        }}
      >
        {state.kind === "submitting" ? "Submitting…" : "Send to Lena"}
      </button>
    </form>
  );
}
