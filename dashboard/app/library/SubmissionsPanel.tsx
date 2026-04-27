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
  email: string;
  airingPreference: "one_off" | "permanent";
  status: "approved" | "rejected" | "withdrawn";
  rejectReason: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [findEmail, setFindEmail] = useState("");
  const [findRows, setFindRows] = useState<Reviewed[] | null>(null);
  const [findLoading, setFindLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/submissions/list", { cache: "no-store" });
      if (!r.ok) return;
      setData((await r.json()) as ListResponse);
    } catch {
      /* keep previous */
    }
  }, []);

  const findByEmail = useCallback(async () => {
    const email = findEmail.trim();
    if (!email) {
      setFindRows(null);
      return;
    }
    setFindLoading(true);
    try {
      const r = await fetch(`/api/submissions/find?email=${encodeURIComponent(email)}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        toast.error(`Search failed: HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { rows: Reviewed[] };
      setFindRows(j.rows);
    } catch (err) {
      toast.error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFindLoading(false);
    }
  }, [findEmail]);

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

  async function withdraw(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "artist requested withdrawal" }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; keptContact?: boolean };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success(
        j.keptContact
          ? "Withdrawn — track pulled, email retained (permanent rotation)."
          : "Withdrawn — track pulled, email + name scrubbed (one-off).",
      );
      await refresh();
    } catch (err) {
      toast.error(`Withdraw failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function fullDelete(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/submissions/${id}/full-delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "artist requested full deletion" }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
      toast.success("Fully deleted — row, track, assets all removed.");
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return null;

  // Single row renderer reused by "Recently reviewed" and "Find by email"
  const renderReviewedRow = (r: Reviewed) => {
    const ts = r.withdrawnAt ?? r.reviewedAt;
    return (
      <li
        key={r.id}
        className="border border-line rounded p-2.5 flex flex-col gap-1.5 bg-bg"
      >
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex flex-col">
            <span className="text-sm text-fg font-medium">{r.artistName}</span>
            <span className="text-[10px] text-fg-mute" title={r.email}>
              {r.email}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
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
            <span className="text-fg-dim">{ts ? relativeTime(ts) : "—"}</span>
          </div>
        </div>
        {r.status === "rejected" && r.rejectReason && (
          <p className="text-[11px] text-fg-mute italic">{r.rejectReason}</p>
        )}
        {r.status === "withdrawn" && r.withdrawnReason && (
          <p className="text-[11px] text-fg-mute italic">
            Withdrawn — {r.withdrawnReason}
          </p>
        )}
        {r.status === "approved" && (
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`px-1.5 py-0.5 rounded border text-[9px] ${
                r.airingPreference === "permanent"
                  ? "border-accent text-accent"
                  : "border-line text-fg-mute"
              }`}
            >
              {r.airingPreference === "permanent" ? "Perm" : "One-off"}
            </span>
            {confirmDelete === r.id ? (
              <>
                <span className="text-[10px] text-bad uppercase tracking-widest">
                  Delete everything?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => fullDelete(r.id)}
                  disabled={busy === r.id}
                  className="text-[10px] px-2 py-1 h-auto"
                >
                  {busy === r.id ? "…" : "Yes, wipe"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(null)}
                  className="text-[10px] px-2 py-1 h-auto"
                >
                  No
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => withdraw(r.id)}
                  disabled={busy !== null}
                  className="text-[10px] px-2 py-1 h-auto"
                  title="Pull from rotation. Permanent → keep email, One-off → scrub email."
                >
                  Withdraw
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(r.id)}
                  disabled={busy !== null}
                  className="text-[10px] px-2 py-1 h-auto border-bad/40 text-bad"
                  title="Wipe everything (track + row + assets). Use only if artist explicitly asks for total deletion."
                >
                  Full delete
                </Button>
              </>
            )}
          </div>
        )}
      </li>
    );
  };

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

        {/* Find-by-email — for acting on tracks older than the recent-20 list */}
        <details className="mt-2">
          <summary className="text-xs uppercase tracking-widest text-fg-mute cursor-pointer">
            Find by email (artist withdrawal requests)
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                findByEmail();
              }}
            >
              <input
                type="email"
                value={findEmail}
                onChange={(e) => setFindEmail(e.target.value)}
                placeholder="artist@example.com"
                className="flex-1 bg-bg border border-line rounded px-2 py-1.5 text-sm font-mono outline-none focus:border-accent"
              />
              <Button
                size="sm"
                type="submit"
                disabled={findLoading || findEmail.trim().length < 3}
                className="text-[10px] px-3 py-1 h-auto"
              >
                {findLoading ? "…" : "Find"}
              </Button>
              {findRows && (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setFindRows(null);
                    setFindEmail("");
                  }}
                  className="text-[10px] px-3 py-1 h-auto"
                >
                  Clear
                </Button>
              )}
            </form>
            {findRows && findRows.length === 0 && (
              <p className="text-[11px] text-fg-mute">No submissions found for that email.</p>
            )}
            {findRows && findRows.length > 0 && (
              <ul className="flex flex-col gap-2 text-xs">
                {findRows.map(renderReviewedRow)}
              </ul>
            )}
          </div>
        </details>

        {data.reviewed.length > 0 && (
          <details className="mt-2" open>
            <summary className="text-xs uppercase tracking-widest text-fg-mute cursor-pointer">
              Recently reviewed ({data.reviewed.length})
            </summary>
            <ul className="mt-3 flex flex-col gap-2 text-xs">
              {data.reviewed.map(renderReviewedRow)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
