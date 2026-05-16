export function isProducerShoutoutEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_PRODUCER_SHOUTOUT ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
