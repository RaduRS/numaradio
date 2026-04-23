"use client";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SERVICE_NAMES, type ServiceName } from "@/lib/service-names";

interface LogsResponse {
  name: string;
  lines: string[];
  error?: string;
}

export function LogsCard() {
  const [active, setActive] = useState<ServiceName | null>(null);
  const [data, setData] = useState<LogsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await fetch(`/api/logs/${active}?lines=50`, {
          signal: ctl.signal,
          cache: "no-store",
        });
        const json = (await res.json()) as LogsResponse;
        setData(json);
        setErr(json.error ?? null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setErr(e instanceof Error ? e.message : "fetch failed");
      }
    };
    load();
    const id = setInterval(load, 5_000);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [active]);

  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Logs
        </CardTitle>
        <div className="flex flex-wrap gap-1">
          {SERVICE_NAMES.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={active === name ? "default" : "outline"}
              onClick={() => setActive(active === name ? null : name)}
              className="font-mono text-xs"
            >
              {name}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {active === null ? (
          <p className="text-sm text-fg-mute">Pick a service to tail its logs. Polling pauses when no service is selected.</p>
        ) : err ? (
          <p className="text-sm text-[var(--bad)]">Error: {err}</p>
        ) : (
          <pre className="font-mono text-xs text-fg-dim overflow-x-auto max-h-64 whitespace-pre-wrap">
            {data?.lines.join("\n") ?? "Loading…"}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
