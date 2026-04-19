export const SERVICE_NAMES = ["icecast2", "numa-liquidsoap", "cloudflared"] as const;
export const SERVICE_ACTIONS = ["start", "stop", "restart"] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];
