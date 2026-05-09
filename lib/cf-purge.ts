// Cloudflare cache purge wrapper — best-effort. Caller logs the result
// and continues regardless. Kept fetch-injectable so unit tests don't
// hit the real CF API.

export type CfPurgeResult =
  | { ok: true }
  | { skipped: "no_creds" | "empty_urls" }
  | { error: string };

export interface CfPurgeOpts {
  apiToken?: string;
  zoneId?: string;
  fetchImpl?: typeof fetch;
}

export async function purgeCloudflareCache(
  urls: string[],
  opts: CfPurgeOpts = {},
): Promise<CfPurgeResult> {
  const apiToken = opts.apiToken ?? process.env.CF_API_TOKEN ?? "";
  const zoneId = opts.zoneId ?? process.env.CF_ZONE_ID ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (!apiToken || !zoneId) return { skipped: "no_creds" };
  if (urls.length === 0) return { skipped: "empty_urls" };

  try {
    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: urls }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `CF purge HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err) };
  }
}
