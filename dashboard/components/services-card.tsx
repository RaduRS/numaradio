"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusSnapshot } from "@/lib/types";
import { ServiceRow } from "./service-row";

interface Props {
  data: StatusSnapshot | null;
  onActionComplete: () => void;
}

export function ServicesCard({ data, onActionComplete }: Props) {
  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader>
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Services
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data?.services.map((svc) => (
          <ServiceRow key={svc.name} svc={svc} onActionComplete={onActionComplete} />
        )) ?? <div className="px-4 py-6 text-sm text-fg-mute">Loading…</div>}
      </CardContent>
    </Card>
  );
}
