"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Pending = {
  id: string;
  artistName: string;
  email: string;
  airingPreference: "one_off" | "permanent";
  durationSeconds: number | null;
  artworkStorageKey: string | null;
  createdAt: string;
};

type Reviewed = {
  id: string;
  artistName: string;
  status: "approved" | "rejected" | "withdrawn";
  rejectReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

type ListResponse = { pending: Pending[]; reviewed: Reviewed[] };

const PUBLIC_SITE = "https://numaradio.com";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function fmtDur(s: number | null): string {
  if (s == null) return "?";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function SubmissionsPanel() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/submissions/list", { cache: "no-store" });
      if (!r.ok) return;
      setData((await r.json()) as ListResponse);
    } catch {
      /* keep previous */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function approve(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/approve`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success("Approved — track ingested.");
      await refresh();
    } catch (err) {
      toast.error(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    if (rejectReason.trim().length < 3) {
      toast.error("Reason must be at least 3 characters.");
      return;
    }
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success("Rejected.");
      setRejectingId(null);
      setRejectReason("");
      await refresh();
    } catch (err) {
      toast.error(`Reject failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return null;

  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
            Music submissions
          </CardTitle>
          <span className="font-mono text-[10px] text-fg-dim uppercase tracking-[0.15em]">
            {data.pending.length} pending · {data.reviewed.length} recent
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.pending.length === 0 && (
          <p className="text-sm text-fg-mute">Nothing waiting.</p>
        )}

        <ul className="flex flex-col gap-3">
          {data.pending.map((p) => (
            <li
              key={p.id}
              className="border border-line rounded p-3 flex flex-col gap-2 bg-bg"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{p.artistName}</span>
                  <span className="text-xs text-fg-mute">{p.email}</span>
                </div>
                <span className="text-xs text-fg-dim">{relativeTime(p.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`px-2 py-0.5 rounded border ${
                    p.airingPreference === "permanent"
                      ? "border-accent text-accent"
                      : "border-line text-fg-mute"
                  }`}
                >
                  {p.airingPreference === "permanent" ? "Permanent" : "One-off"}
                </span>
                <span className="text-fg-dim">{fmtDur(p.durationSeconds)}</span>
                {p.artworkStorageKey && <span className="text-fg-dim">+ artwork</span>}
              </div>
              <audio
                src={`${PUBLIC_SITE}/api/submissions/${p.id}/audio`}
                controls
                preload="none"
                className="w-full"
              />

              {rejectingId === p.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why are we rejecting this? (stored, not sent yet)"
                    rows={2}
                    className="bg-bg border border-line rounded p-2 text-sm outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => reject(p.id)}
                      disabled={busy === p.id}
                    >
                      {busy === p.id ? "…" : "Confirm reject"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectReason("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => approve(p.id)}
                    disabled={busy === p.id}
                  >
                    {busy === p.id ? "…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejectingId(p.id)}
                    disabled={busy !== null}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {data.reviewed.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs uppercase tracking-widest text-fg-mute cursor-pointer">
              Recently reviewed (last {data.reviewed.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {data.reviewed.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 border-b border-line py-1"
                >
                  <span className="text-fg">{r.artistName}</span>
                  <span
                    className={
                      r.status === "approved"
                        ? "text-accent"
                        : r.status === "rejected"
                        ? "text-bad"
                        : "text-fg-mute"
                    }
                  >
                    {r.status}
                  </span>
                  <span className="text-fg-dim">
                    {r.reviewedAt ? relativeTime(r.reviewedAt) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
