"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GripVerticalIcon } from "lucide-react";
import { usePolling } from "@/hooks/use-polling";

type UpcomingTrack = {
  id: string;
  position: number;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  artworkUrl: string | null;
  ageDays: number | null;
};

type UpcomingResponse = {
  ok: boolean;
  manualMode: boolean;
  tracks: UpcomingTrack[];
  error?: string;
};

function fmtDur(s: number | null): string {
  if (s === null || s === undefined) return "—";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function fmtAge(days: number | null): { label: string; cls: string } {
  if (days === null || days === undefined) return { label: "—", cls: "text-fg-dim" };
  if (days < 7) return { label: String(days), cls: "text-accent" };
  if (days < 30) return { label: String(days), cls: "text-fg" };
  if (days < 365) return { label: String(days), cls: "text-fg-mute" };
  return { label: String(days), cls: "text-fg-dim" };
}

function SortableRow({ track, position }: { track: UpcomingTrack; position: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const age = fmtAge(track.ageDays);
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2 border-b border-line/60 last:border-b-0 bg-bg-1 hover:bg-[var(--bg-2)] transition-colors"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab active:cursor-grabbing text-fg-dim hover:text-fg p-1 -ml-1 touch-none"
        aria-label={`Drag ${track.title}`}
        title="Drag to reorder"
      >
        <GripVerticalIcon className="h-4 w-4" />
      </button>
      <span className="font-mono text-[11px] tabular-nums text-fg-dim w-6 shrink-0 text-right">
        {position}
      </span>
      {track.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.artworkUrl}
          alt=""
          loading="lazy"
          className="w-8 h-8 rounded-sm object-cover shrink-0 border border-line/60"
        />
      ) : (
        <div className="w-8 h-8 rounded-sm shrink-0 bg-[var(--bg-2)] border border-line/60" aria-hidden />
      )}
      <div className="min-w-0 flex-1 flex items-baseline gap-2">
        <span className="text-sm text-fg truncate">{track.title}</span>
        {track.artist ? (
          <span className="text-xs text-fg-dim truncate">{track.artist}</span>
        ) : null}
      </div>
      <span
        className={`font-mono text-[10px] uppercase tabular-nums shrink-0 w-12 text-right ${age.cls}`}
        title={track.ageDays === null ? "Unknown age" : `Added ${track.ageDays} day${track.ageDays === 1 ? "" : "s"} ago`}
      >
        {age.label}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-fg-dim shrink-0 w-10 text-right">
        {fmtDur(track.durationSeconds)}
      </span>
    </li>
  );
}

export function UpcomingQueue() {
  // No limit cap on the poll: if we cap at 20 and the operator hits Save,
  // we send only the first 20 ids — the rest of the m3u is silently
  // dropped by buildManualPlaylist. Sending the full m3u keeps the
  // operator's "save" non-destructive.
  const { data, refresh } = usePolling<UpcomingResponse>("/api/rotation/upcoming?limit=200", 5_000);
  const [order, setOrder] = useState<UpcomingTrack[] | null>(null);
  const [saving, setSaving] = useState(false);
  // Track whether the operator has unsaved local edits — if so, polling
  // overwrites are paused so a 5s tick doesn't yank the list mid-drag.
  const [dirty, setDirty] = useState(false);
  // After a successful save, hold the local order for a few ticks so the
  // poll doesn't briefly flash the pre-propagation snapshot back at us
  // before the daemon's manual-mode m3u write reaches the dashboard.
  const [pinnedUntil, setPinnedUntil] = useState(0);

  useEffect(() => {
    if (dirty) return; // don't clobber unsaved edits
    if (Date.now() < pinnedUntil) return; // wait for save propagation
    if (data?.tracks) setOrder(data.tracks);
  }, [data, dirty, pinnedUntil]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => (order ?? []).map((t) => t.id), [order]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id || !order) return;
    const oldIdx = order.findIndex((t) => t.id === active.id);
    const newIdx = order.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    setOrder(arrayMove(order, oldIdx, newIdx));
    setDirty(true);
  }

  async function save() {
    if (!order || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rotation/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackIds: order.map((t) => t.id) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Save failed: ${j.error ?? res.status}`);
        return;
      }
      toast.success(`Manual order saved — ${j.poolSize} tracks queued`);
      setDirty(false);
      // Hold for ~3s so the post-save poll (which races the daemon's m3u
      // rename) can't briefly flash the pre-save order back into view.
      setPinnedUntil(Date.now() + 3000);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setSaving(false);
    }
  }

  async function resumeAuto() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rotation/manual", { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Resume failed: ${j.error ?? res.status}`);
        return;
      }
      toast.success("Auto rotation resumed");
      setDirty(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "network error");
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    if (data?.tracks) setOrder(data.tracks);
    setDirty(false);
  }

  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-baseline gap-3">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
            Up Next
          </CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
            {data?.manualMode ? (
              <span className="text-accent">manual order · {order?.length ?? 0} tracks</span>
            ) : (
              <span className="text-fg-dim">auto · drag to take control</span>
            )}
          </span>
          {dirty ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--warn)]">
              unsaved
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <>
              <Button variant="ghost" size="sm" onClick={revert} disabled={saving}>Revert</Button>
              <Button variant="default" size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save order"}
              </Button>
            </>
          ) : data?.manualMode ? (
            <Button variant="outline" size="sm" onClick={resumeAuto} disabled={saving}>
              {saving ? "Working…" : "Resume auto"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!order ? (
          <div className="px-4 py-6 text-sm text-fg-mute">Loading…</div>
        ) : order.length === 0 ? (
          <div className="px-4 py-6 text-sm text-fg-mute">Playlist is empty.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {/* Column headers — match the SortableRow column widths exactly */}
              <div className="flex items-center gap-3 px-3 py-1.5 border-b border-line bg-[var(--bg-2)] font-mono text-[10px] uppercase tracking-[0.18em] text-fg-mute">
                <span className="w-6 shrink-0" aria-hidden /> {/* grip */}
                <span className="w-6 shrink-0 text-right">#</span>
                <span className="w-8 shrink-0" aria-hidden /> {/* art */}
                <span className="flex-1 min-w-0">Track</span>
                <span className="w-12 shrink-0 text-right" title="Days since added to library">Days</span>
                <span className="w-10 shrink-0 text-right">Dur</span>
              </div>
              <ul className="divide-y divide-line/60">
                {order.map((track, i) => (
                  <SortableRow key={track.id} track={track} position={i + 1} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}
