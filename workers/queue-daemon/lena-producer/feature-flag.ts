export function isShiftMemoryEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_SHIFT_MEMORY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
