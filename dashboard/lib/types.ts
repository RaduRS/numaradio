import type { ServiceName } from "./systemd";

export interface StatusSnapshot {
  ts: string;
  stream: {
    publicUrl: string;
    reachable: boolean;
    listeners: number | null;
    listenerPeak: number | null;
    bitrate: number | null;
    nowPlaying: { artist: string | null; title: string } | null;
    error?: string;
  };
  services: {
    name: ServiceName;
    state: "active" | "inactive" | "failed" | "activating" | "deactivating" | "unknown";
    activeSince: string | null;
    uptimeSec: number | null;
  }[];
  health: {
    neon: { ok: boolean; latencyMs?: number; error?: string };
    b2: { ok: boolean; latencyMs?: number; error?: string };
    tunnel: { ok: boolean; connections: number; error?: string };
  };
}
