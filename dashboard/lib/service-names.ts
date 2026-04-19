export const SERVICE_NAMES = ["icecast2", "numa-liquidsoap"] as const;
export const SERVICE_ACTIONS = ["start", "stop", "restart"] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

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
