"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePolling } from "@/hooks/use-polling";

// Google revokes refresh tokens for OAuth projects in Testing mode after
// ~7 days. We can't push the consent screen to production for free
// (youtube.readonly is a sensitive scope, would need verification), so
// the operator re-mints weekly via the OAuth Playground.
//
// This card surfaces the countdown so the operator doesn't get caught
// out — and bundles the recovery steps inline so a tired operator at
// 11pm doesn't have to dig through HANDOFF.md.
//
// Source of truth: process.env.YOUTUBE_OAUTH_MINTED_AT (ISO 8601 UTC).
// Operator updates this in Vercel env at the same time as
// YOUTUBE_OAUTH_REFRESH_TOKEN.

interface OAuthMeta {
  mintedAt: string | null;
  expiresAt: string | null;
  msUntilExpiry: number | null;
  status: "fresh" | "warn" | "urgent" | "expired" | "unset";
}

interface PillStyle {
  label: string;
  bg: string;
  border: string;
  text: string;
  pulse: boolean;
}

function statusPill(meta: OAuthMeta | null): PillStyle {
  if (!meta || meta.status === "unset") {
    return {
      label: "MINTED-AT UNSET",
      bg: "bg-fg-mute/10",
      border: "border-fg-mute/30",
      text: "text-fg-mute",
      pulse: false,
    };
  }
  if (meta.status === "expired") {
    return {
      label: "EXPIRED",
      bg: "bg-red-500/10",
      border: "border-red-500/40",
      text: "text-red-400",
      pulse: true,
    };
  }
  if (meta.status === "urgent") {
    return {
      label: "EXPIRES SOON",
      bg: "bg-red-500/10",
      border: "border-red-500/40",
      text: "text-red-400",
      pulse: true,
    };
  }
  if (meta.status === "warn") {
    return {
      label: "REFRESH SOON",
      bg: "bg-amber-500/10",
      border: "border-amber-500/40",
      text: "text-amber-400",
      pulse: false,
    };
  }
  return {
    label: "FRESH",
    bg: "bg-accent/10",
    border: "border-accent/40",
    text: "text-accent",
    pulse: false,
  };
}

function fmtCountdown(ms: number | null): string {
  if (ms === null) return "—";
  if (ms <= 0) return "expired";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function fmtMintedAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function YoutubeOauthCard() {
  // Server returns msUntilExpiry but it ages while the tab sits open.
  // We tick a local clock once a minute so the countdown decrements
  // visually without burning the API.
  const poll = usePolling<OAuthMeta>("/api/youtube/oauth-meta", 5 * 60_000);
  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [stepsOpen, setStepsOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const meta = poll.data;

  // Auto-expand the recovery steps when the token is in trouble. We
  // don't force-close on the way back down — operator may want to keep
  // them visible after refreshing to confirm the new countdown.
  useEffect(() => {
    if (meta?.status === "expired" || meta?.status === "urgent") {
      setStepsOpen(true);
    }
  }, [meta?.status]);
  // Recompute msUntilExpiry against the local clock so the card ages
  // smoothly between server polls.
  const liveMsUntilExpiry =
    meta?.expiresAt && now > 0
      ? new Date(meta.expiresAt).getTime() - now
      : (meta?.msUntilExpiry ?? null);
  const liveMeta: OAuthMeta | null = meta
    ? { ...meta, msUntilExpiry: liveMsUntilExpiry }
    : null;
  const pill = statusPill(liveMeta);

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
    } catch {
      /* clipboard blocked — caller can read & paste manually */
    }
  };

  const sedCommand = `sudo sed -i 's|^YOUTUBE_OAUTH_REFRESH_TOKEN=.*|YOUTUBE_OAUTH_REFRESH_TOKEN=<NEW_TOKEN>|' /etc/numa/env && sudo systemctl restart numa-queue-daemon`;
  const scopeUrl = "https://www.googleapis.com/auth/youtube.readonly";

  return (
    <Card className="border-line bg-bg-1">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          YouTube · OAuth Token
        </CardTitle>
        <button
          type="button"
          onClick={() => setStepsOpen((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute transition-colors hover:text-accent"
        >
          {stepsOpen ? "Hide steps" : "Show steps"}
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${pill.bg} ${pill.border} ${pill.text}`}
          >
            <span className="relative inline-flex h-2 w-2">
              {pill.pulse && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full bg-current opacity-60"
                />
              )}
              <span aria-hidden className="absolute inset-0 rounded-full bg-current" />
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.2em]">
              {pill.label}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Time left
            </span>
            <span className="font-display text-xl font-extrabold tabular-nums text-fg">
              {fmtCountdown(liveMsUntilExpiry)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3 font-mono text-[11px]">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Last minted
            </span>
            <span className="text-fg-dim tabular-nums">
              {fmtMintedAt(meta?.mintedAt ?? null)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              7-day TTL
            </span>
            <span className="text-fg-dim tabular-nums">
              {fmtMintedAt(meta?.expiresAt ?? null)}
            </span>
          </div>
        </div>

        {meta?.status === "unset" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-[11px] text-amber-300">
            Set <span className="text-fg">YOUTUBE_OAUTH_MINTED_AT</span> in Vercel
            env (ISO 8601 UTC, e.g. <span className="text-fg">2026-05-05T18:50:00Z</span>) to
            enable the countdown.
          </div>
        )}

        {stepsOpen && (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-bg-2/40 px-3 py-3 font-mono text-[11px] leading-relaxed text-fg-dim">
            <div className="text-[10px] uppercase tracking-[0.2em] text-fg-mute">
              Recovery — 5 min, weekly chore
            </div>

            <div>
              <div className="mb-1 text-fg">1. Mint a fresh refresh token</div>
              <ol className="list-decimal pl-5 marker:text-fg-mute">
                <li>
                  Open{" "}
                  <a
                    href="https://developers.google.com/oauthplayground/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    OAuth Playground
                  </a>
                </li>
                <li>
                  Top-right ⚙ → <em>Use your own OAuth credentials</em> → paste
                  Client ID + Secret → tick <em>Force prompt</em>
                </li>
                <li>
                  Step 1 → paste this scope into the input box:
                  <div className="mt-1 flex items-center gap-2">
                    <code className="break-all rounded bg-bg-1 px-2 py-1 text-fg">
                      {scopeUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy("scope", scopeUrl)}
                      className="shrink-0 rounded border border-line px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-fg-dim hover:border-accent/50 hover:text-accent"
                    >
                      {copied === "scope" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </li>
                <li>
                  Click <em>Authorize APIs</em>, sign in with the @numaradio
                  Google account
                </li>
                <li>
                  Step 2 → click <em>Exchange authorization code for tokens</em>
                  → copy the new <em>Refresh token</em>
                </li>
              </ol>
            </div>

            <div>
              <div className="mb-1 text-fg">2. Update Vercel env (both projects)</div>
              <ol className="list-decimal pl-5 marker:text-fg-mute">
                <li>
                  Vercel → numaradio + dashboard projects → Settings → Environment
                  Variables
                </li>
                <li>
                  Edit <span className="text-fg">YOUTUBE_OAUTH_REFRESH_TOKEN</span> →
                  paste the new value
                </li>
                <li>
                  Update <span className="text-fg">YOUTUBE_OAUTH_MINTED_AT</span> to
                  the current UTC time (
                  <span className="text-fg">{new Date().toISOString()}</span>)
                </li>
                <li>Save → trigger a redeploy</li>
              </ol>
            </div>

            <div>
              <div className="mb-1 text-fg">3. Update Orion (/etc/numa/env)</div>
              <div className="flex items-start gap-2">
                <code className="block flex-1 break-all rounded bg-bg-1 px-2 py-1 text-fg">
                  {sedCommand}
                </code>
                <button
                  type="button"
                  onClick={() => copy("sed", sedCommand)}
                  className="shrink-0 rounded border border-line px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-fg-dim hover:border-accent/50 hover:text-accent"
                >
                  {copied === "sed" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-1 text-fg-mute">
                Replace <span className="text-fg-dim">&lt;NEW_TOKEN&gt;</span>{" "}
                before running.
              </div>
            </div>

            <div className="border-t border-line pt-2 text-[10px] text-fg-mute">
              Verify: <code className="text-fg-dim">curl -s https://numaradio.com/api/youtube/state</code>
              {" "}→ <span className="text-fg-dim">{`{"state":"live",...}`}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
