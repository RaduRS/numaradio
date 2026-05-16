export function isShiftMemoryEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_SHIFT_MEMORY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

export function isProducerAutoEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_PRODUCER_AUTO ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

export function isQueueAutonomyEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_QUEUE_AUTONOMY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
