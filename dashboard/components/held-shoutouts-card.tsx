"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtRelative } from "@/lib/fmt";
import type { ShoutoutRow } from "@/lib/shoutouts";

// `[YT] ` prefix marks shoutouts ingested from YouTube live chat
// (added in app/api/internal/youtube-chat-shoutout/route.ts on the public app).
function parseRequester(name: string | null | undefined): {
  source: "youtube" | "booth";
  clean: string;
} {
  const trimmed = name?.trim() ?? "";
  if (trimmed.startsWith("[YT]")) {
    return { source: "youtube", clean: trimmed.replace(/^\[YT\]\s*/, "") };
  }
  return { source: "booth", clean: trimmed };
}

// Lucide's Youtube icon (MIT) inlined: dashboard's lucide-react@1.8 lacks it.
function YoutubeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="YouTube"
    >
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

interface Props {
  held: ShoutoutRow[];
  onAction: () => void;
  /**
   * When true, the card is only rendered if `held.length > 0`.
   * Used on the main dashboard where the card should vanish when idle.
   * Default false: always render (used on /shoutouts where the empty
   * state is also informative).
   */
  hideWhenEmpty?: boolean;
}

export function HeldShoutoutsCard({ held, onAction, hideWhenEmpty = false }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/shoutouts/${id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `failed to ${action}`);
      } else if (action === "approve") {
        toast.success("Approved — Lena is on it.");
      } else {
        toast.success("Rejected.");
      }
      onAction();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setBusyId(null);
    }
  }

  if (hideWhenEmpty && held.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          Held for review
          <Badge className="border-[var(--warn)] text-[var(--warn)]">
            {held.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {held.length === 0 ? (
          <p className="text-sm text-fg-mute">
            Nothing waiting. MiniMax is handling everything that&apos;s come in.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--line)]">
            {held.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="flex-1 min-w-0">
                  {(() => {
                    const { source, clean } = parseRequester(s.requesterName);
                    return (
                      <div className="flex items-center gap-2 mb-1">
                        {source === "youtube" && <YoutubeIcon size={14} />}
                        <span className="font-mono text-xs uppercase tracking-[0.15em]">
                          {clean || "anonymous"}
                        </span>
                        <span className="font-mono text-[10px] text-fg-mute">
                          {fmtRelative(s.createdAt)}
                        </span>
                      </div>
                    );
                  })()}
                  <p className="text-sm break-words">
                    &ldquo;{s.cleanText ?? s.rawText}&rdquo;
                  </p>
                  {s.cleanText && s.cleanText !== s.rawText && (
                    <p className="mt-1 text-xs text-fg-mute break-words">
                      original: {s.rawText}
                    </p>
                  )}
                  {s.moderationReason && (
                    <p className="mt-1 text-xs text-fg-mute break-words">
                      reason: {s.moderationReason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 sm:shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "approve")}
                    className="flex-1 sm:flex-initial"
                  >
                    {busyId === s.id ? "…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "reject")}
                    className="flex-1 sm:flex-initial"
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
