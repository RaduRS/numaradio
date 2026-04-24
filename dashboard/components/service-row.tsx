"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { StatusSnapshot } from "@/lib/types";

type Service = StatusSnapshot["services"][number];

function fmtUptime(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

interface Props {
  svc: Service;
  onActionComplete: () => void;
}

export function ServiceRow({ svc, onActionComplete }: Props) {
  const [pending, setPending] = useState<null | "start" | "stop" | "restart">(null);

  async function run(action: "start" | "stop" | "restart") {
    setPending(action);
    try {
      const res = await fetch(`/api/services/${svc.name}/${action}`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string; state?: string; durationMs?: number };
      if (res.ok && json.ok) {
        // Build the parenthetical from a filter-boolean array so the
        // closing `)` is always paired with its opening `(`. The old
        // template literal dropped the close when `state` was present
        // but `durationMs` was absent.
        const parts = [
          json.state ?? null,
          json.durationMs != null ? `${(json.durationMs / 1000).toFixed(1)}s` : null,
        ].filter((p): p is string => p !== null);
        const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        toast.success(`${action}ed ${svc.name}${detail}`);
        onActionComplete();
      } else {
        toast.error(`Failed to ${action} ${svc.name}`, { description: json.error ?? "unknown error" });
      }
    } catch (e) {
      toast.error(`Failed to ${action} ${svc.name}`, {
        description: e instanceof Error ? e.message : "network error",
      });
    } finally {
      setPending(null);
    }
  }

  const stateColor =
    svc.state === "active"
      ? "border-accent text-accent bg-[var(--accent-soft)]"
      : svc.state === "activating" || svc.state === "deactivating"
        ? "border-[var(--warn)] text-[var(--warn)]"
        : "border-[var(--bad)] text-[var(--bad)]";

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      {/* Row 1 (mobile) / left cluster (desktop): name + uptime, with the
          state badge flipping to the trailing edge on narrow widths so
          the operator can see status without scrolling controls. */}
      <div className="flex min-w-0 items-center justify-between gap-3 sm:flex-1">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-sm">{svc.name}</span>
          <span className="text-xs text-fg-mute">
            uptime {fmtUptime(svc.uptimeSec)}
          </span>
        </div>
        <Badge variant="outline" className={`shrink-0 sm:hidden ${stateColor}`}>
          {svc.state}
        </Badge>
      </div>
      {/* Row 2 (mobile) / right cluster (desktop): state badge + controls */}
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={`hidden sm:inline-flex ${stateColor}`}
        >
          {svc.state}
        </Badge>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!pending || svc.state === "active"}
          onClick={() => run("start")}
          className="flex-1 sm:flex-initial"
        >
          {pending === "start" ? "…" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!pending || svc.state === "inactive" || svc.state === "failed"}
          onClick={() => run("stop")}
          className="flex-1 sm:flex-initial"
        >
          {pending === "stop" ? "…" : "Stop"}
        </Button>
        <Dialog>
          <DialogTrigger
            disabled={!!pending}
            render={
              <Button size="sm" variant="secondary" className="flex-1 sm:flex-initial">
                {pending === "restart" ? "…" : "Restart"}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restart {svc.name}?</DialogTitle>
              <DialogDescription>
                The stream may drop for a few seconds while this service restarts.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <DialogClose
                render={
                  <Button onClick={() => run("restart")}>Confirm restart</Button>
                }
              />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
