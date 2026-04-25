# Archived one-shot scripts

These scripts have already been executed against production data and
are kept here for historical reference, not for re-running. Each was
written for a specific data migration moment that has passed.

| Script | What it did |
|---|---|
| `migrate-publicurl-to-cdn.ts` | Rewrote `Track.audioStreamUrl` from B2 direct URLs to `cdn.numaradio.com` after the Cloudflare CDN went live. |
| `backfill-suno-metadata.ts` | Backfilled MiniMax/Suno metadata onto pre-existing tracks from a previous import. |
| `backfill-b2-cache-control.ts` | One-pass copy of every B2 object onto itself with `Cache-Control` headers attached, after the `putObject` defaults were tightened. |
| `backfill-song-duration.ts` | Probed every Track's MP3 to populate `durationSeconds` after the schema added the column. |
| `demote-listener-songs.ts` | One-time cleanup that flipped existing listener-generated songs out of the rotation pool. |

If a similar migration ever needs to run again, copy the relevant
file back to `scripts/` and modify in place — don't re-execute these
verbatim.
