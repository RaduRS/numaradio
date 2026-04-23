import "server-only";

export const NANOCLAW_CHAT_URL =
  process.env.NANOCLAW_CHAT_URL ?? "http://127.0.0.1:4001";

/**
 * Build headers for a request to the NanoClaw HTTP channel. Always
 * includes the shared secret. Callers add Content-Type as needed.
 */
export function nanoclawHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  return { "x-internal-secret": secret };
}

/**
 * The single `dashboard:main` group — one persistent conversation shared
 * by all operators. Mirrored on the NanoClaw side in `channels/http.ts`.
 */
export const DASHBOARD_GROUP_JID = "dashboard:main";
