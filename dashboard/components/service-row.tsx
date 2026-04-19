"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
        toast.success(
          `${action}ed ${svc.name}${json.state ? ` (${json.state}` : ""}${
            json.durationMs ? ` in ${(json.durationMs / 1000).toFixed(1)}s)` : ")"
          }`,
        );
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
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line last:border-0">
      <div className="flex flex-col">
        <span className="font-mono text-sm">{svc.name}</span>
        <span className="text-xs text-fg-mute">uptime {fmtUptime(svc.uptimeSec)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={stateColor}>
          {svc.state}
        </Badge>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!pending || svc.state === "active"}
          onClick={() => run("start")}
        >
          {pending === "start" ? "…" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!pending || svc.state === "inactive" || svc.state === "failed"}
          onClick={() => run("stop")}
        >
          {pending === "stop" ? "…" : "Stop"}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="secondary" disabled={!!pending}>
              {pending === "restart" ? "…" : "Restart"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restart {svc.name}?</DialogTitle>
              <DialogDescription>
                The stream may drop for a few seconds while this service restarts.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button onClick={() => run("restart")}>Confirm restart</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
