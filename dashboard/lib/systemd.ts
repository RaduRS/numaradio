import "server-only";
import { spawn } from "node:child_process";
import {
  SERVICE_NAMES,
  SERVICE_ACTIONS,
  type ServiceName,
  type ServiceAction,
} from "./service-names";

export { SERVICE_NAMES, SERVICE_ACTIONS };
export type { ServiceName, ServiceAction };

const SERVICES = new Set<string>(SERVICE_NAMES);
const ACTIONS = new Set<string>(SERVICE_ACTIONS);

export function validateServiceAction(
  name: string,
  action: string,
): { name: ServiceName; action: ServiceAction } {
  if (!SERVICES.has(name)) throw new Error(`invalid service: ${JSON.stringify(name)}`);
  if (!ACTIONS.has(action)) throw new Error(`invalid action: ${JSON.stringify(action)}`);
  return { name: name as ServiceName, action: action as ServiceAction };
}

export interface ActionResult {
  ok: boolean;
  durationMs: number;
  stderr?: string;
}

export async function runServiceAction(
  name: ServiceName,
  action: ServiceAction,
  timeoutMs = 15_000,
): Promise<ActionResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      "sudo",
      ["-n", "systemctl", action, name],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        durationMs: Date.now() - start,
        stderr: stderr.trim() || undefined,
      });
    });
  });
}

export interface ServiceState {
  name: ServiceName;
  state: "active" | "inactive" | "failed" | "activating" | "deactivating" | "unknown";
  activeSince: string | null;
  uptimeSec: number | null;
}

export async function getServiceState(name: ServiceName): Promise<ServiceState> {
  return new Promise((resolve) => {
    const child = spawn(
      "systemctl",
      [
        "show",
        name,
        "--property=ActiveState",
        "--property=ActiveEnterTimestamp",
        "--timestamp=unix",
      ],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout?.on("data", (c) => (stdout += c.toString()));
    child.on("close", () => {
      const map = new Map<string, string>();
      for (const line of stdout.split("\n")) {
        const i = line.indexOf("=");
        if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
      }
      const rawState = map.get("ActiveState") ?? "unknown";
      const state: ServiceState["state"] = (
        ["active", "inactive", "failed", "activating", "deactivating"] as const
      ).includes(rawState as never)
        ? (rawState as ServiceState["state"])
        : "unknown";
      const ts = map.get("ActiveEnterTimestamp") ?? "";
      const epoch = ts.startsWith("@") ? Number(ts.slice(1)) : NaN;
      const activeSince = Number.isFinite(epoch) && epoch > 0
        ? new Date(epoch * 1000).toISOString()
        : null;
      const uptimeSec = activeSince
        ? Math.max(0, Math.floor((Date.now() - epoch * 1000) / 1000))
        : null;
      resolve({ name, state, activeSince, uptimeSec });
    });
  });
}

export async function tailServiceLogs(
  name: ServiceName,
  lines: number,
): Promise<{ lines: string[]; error?: string }> {
  const capped = Math.min(Math.max(Math.floor(lines) || 0, 1), 500);
  return new Promise((resolve) => {
    const child = spawn(
      "journalctl",
      ["-u", name, "-n", String(capped), "--no-pager", "-o", "short-iso"],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => (stdout += c.toString()));
    child.stderr?.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ lines: [], error: stderr.trim() || `exit ${code}` });
        return;
      }
      const out = stdout.split("\n").filter((l) => l.length > 0);
      resolve({ lines: out });
    });
  });
}
