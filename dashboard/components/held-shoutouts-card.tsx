"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ShoutoutRow } from "@/lib/shoutouts";

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

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 600) return `${Math.floor(sec / 60)}m ago`;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return hhmm;
  const mmmdd = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${mmmdd} ${hhmm}`;
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
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono text-xs uppercase tracking-[0.15em]">
                      {s.requesterName ?? "anonymous"}
                    </span>
                    <span className="font-mono text-[10px] text-fg-mute">
                      {fmtRelative(s.createdAt)}
                    </span>
                  </div>
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
