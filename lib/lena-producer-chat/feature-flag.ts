export function isProducerReplyEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_PRODUCER_REPLY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
