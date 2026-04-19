export interface TunnelHealth {
  ok: boolean;
  connections: number;
  error?: string;
}

export function parseTunnelMetrics(text: string): TunnelHealth {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^cloudflared_tunnel_ha_connections\s+(\d+)/);
    if (m) {
      const n = Number(m[1]);
      return { ok: n > 0, connections: n };
    }
  }
  return { ok: false, connections: 0, error: "metric cloudflared_tunnel_ha_connections not found" };
}

export async function fetchTunnelHealth(
  url: string,
  timeoutMs = 2_000,
): Promise<TunnelHealth> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return { ok: false, connections: 0, error: `HTTP ${res.status}` };
    const text = await res.text();
    return parseTunnelMetrics(text);
  } catch (e) {
    return {
      ok: false,
      connections: 0,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  } finally {
    clearTimeout(t);
  }
}
