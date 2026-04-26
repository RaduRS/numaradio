# Lena world_aside chatter — design

Date: 2026-04-26

## Problem

Auto-chatter (LIVE since Apr) gives Lena a voice between songs. The
context-line tier (LIVE today) writes truthful state-aware lines.
Both are inward-facing — they reflect Numa Radio's own state.

Listeners describe wanting Lena to "feel connected to the outside
world": weather in big cities, what's happening in music, AI/tech
news, that kind of thing. Right now she has none of that — she only
knows the catalogue and the wall.

This spec gives Lena ears and eyes via Brave Search, mediated by
NanoClaw (the existing agent on Orion), threaded into the existing
auto-chatter rotation as a new `world_aside` slot type.

## Goal

When the operator turns on a new "World chatter" toggle, ~3 of every
20 auto-chatter voice breaks become "world asides" — short Lena
on-air mentions of one real outside-world fact (weather, music news,
AI news, "on this day" anniversary, light culture trend, or
astronomical event), researched live via Brave Search, written by
NanoClaw in Lena's voice, broadcast through the existing audio
pipeline. Same TTS, same overlay queue, same UI on the public site.

## Non-goals

- Replacing auto-chatter — world_aside is one slot type inside the
  existing 20-slot rotation, not a separate worker
- Politics, war, disasters, religion, sports — divisive or
  mood-killing topics, hard NO
- Real-time breaking news — Brave's freshness is good enough; we're
  not racing news wires
- Per-listener personalisation — one world_aside per slot, every
  listener hears the same line
- Replacing the listener gate — when auto-chatter is silent (under
  5 listeners or `forced_off`), world_aside is also silent
- Independent listener gate — toggle B does not introduce a second
  listener threshold; it composes with toggle A's existing gate

## Architecture (additive on top of existing auto-chatter)

```
┌─ Dashboard /shoutouts ───────────────────────────────────────┐
│  Auto-chatter [ Auto · Forced On · Forced Off ]              │
│  World chatter [ Auto · Forced On · Forced Off ]   ← NEW     │
│   ↓                                                           │
│   POST /api/shoutouts/auto-host        (existing)            │
│   POST /api/shoutouts/world-chatter    (NEW)                 │
│   ↓                                                           │
│  Station table { autoHostMode, worldAsideMode, ... }         │
└──────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─ queue-daemon (Orion) ───────────────────────────────────────┐
│  AutoHostOrchestrator.runChatter() — every ~3 music tracks   │
│                                                               │
│  ▶ Read StationConfigCache → check toggle A (auto-chatter)   │
│    forced_off → return                                        │
│    auto + listeners < 5 → return                              │
│                                                               │
│  ▶ slotTypeFor(slotCounter) → BA / SC / SG / F / W           │
│                                                               │
│  ▶ if W (world_aside):                                        │
│      • Read StationConfigCache → check toggle B               │
│      • forced_off → demote to filler, prompt MiniMax, done   │
│      • auto/forced_on → call NanoClaw HTTP                   │
│            POST 127.0.0.1:4001/world-aside/generate          │
│            { show, recentTopics }                             │
│        Got line? → use it (skip MiniMax)                     │
│        Failed/no good topic? → demote to filler              │
│                                                               │
│  ▶ Generate or use line → Deepgram Helena TTS → B2 upload    │
│  ▶ Push to overlay_queue (Liquidsoap), persist Chatter row   │
└──────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─ NanoClaw (group: world_aside) ──────────────────────────────┐
│  Briefing: groups/world_aside/CLAUDE.md                       │
│  Auth file: groups/world_aside/.auth (Brave API key)          │
│  Tool: brave_search(query) → top 3 results                    │
│                                                                │
│  Editorial loop:                                              │
│   1. Pick topic category (weighted away from recentTopics)    │
│   2. Format query for category                                │
│   3. Brave search → read top 3 results                        │
│   4. Pick a clean angle, or fail with no_good_topic           │
│   5. Write 1-2 sentences in Lena's voice                      │
│   6. Return { topic, line } or { ok:false, reason }           │
└──────────────────────────────────────────────────────────────┘
```

## Schema (one migration)

Add three columns to `Station`, mirroring the existing auto-chatter
trio. Reuses the existing `AutoHostMode` enum.

```prisma
model Station {
  // ... existing fields ...
  autoHostMode           AutoHostMode @default(auto)
  autoHostForcedUntil    DateTime?
  autoHostForcedBy       String?

  worldAsideMode         AutoHostMode @default(auto)   // NEW
  worldAsideForcedUntil  DateTime?                      // NEW
  worldAsideForcedBy     String?                        // NEW
}
```

Migration: `add_world_aside_mode`. No data backfill needed —
defaults to `auto` for the single station row.

## Dashboard UI

`/shoutouts` page gains a second segmented control directly under the
existing Auto-chatter row. Same component, same 3 buttons, same
20-min auto-revert behaviour.

**Status line semantics for the World row:**

| Auto-chatter (A) | World (B)   | Status line                               |
|------------------|-------------|-------------------------------------------|
| any              | forced_off  | "Disabled — slots fall back to filler"    |
| forced_off       | auto/on     | "Silent (auto-chatter is off)"            |
| auto, < 5 lstn   | auto/on     | "Silent (under 5 listeners)"              |
| auto, ≥ 5 lstn   | auto        | "Active — 3/20 slots become asides"       |
| forced_on        | auto        | "Active — 3/20 slots become asides"       |
| any active       | forced_on   | "Active (forced) — 3/20 slots"            |

Plus the existing "Last aside" preview: "World aside 4 min ago:
'Tokyo's seeing rain — quiet kind of weather, fits the hour.'"

**API:** `POST /api/shoutouts/world-chatter` body
`{mode: "auto"|"forced_on"|"forced_off"}`. Parallel to the existing
`/api/shoutouts/auto-host`. Same 20-min auto-revert pattern handled
by the daemon's `revertExpired` callback (extended to cover both
sets of forced-state columns).

## Rotation rewrite

Current 20-slot rotation in `chatter-prompts.ts`:

```
0:BA 1:SC 2:BA 3:F  4:BA 5:SG 6:BA 7:F  8:BA 9:SC
10:BA 11:SG 12:BA 13:F 14:BA 15:SC 16:BA 17:F 18:BA 19:SG
```
Counts: BA=10, SC=3, SG=3, F=4.

New 20-slot rotation:

```
0:SC 1:BA 2:SG 3:BA 4:W  5:BA 6:SC 7:BA 8:SG 9:BA
10:W 11:BA 12:SC 13:BA 14:F 15:BA 16:W 17:BA 18:SG 19:BA
```
Counts: BA=10 (preserved), SC=3 (preserved), SG=3 (preserved),
F=1 (was 4 — gave up 3 fillers to make room), W=3 (new).

**Properties:**
- W at slots 4, 10, 16 — gaps of 6/6/6 (perfectly even, wrapping)
- Filler safety net at slot 14 — if every world_aside slot fails for
  a full cycle, listeners still hear one generic Lena station-ID
- No two adjacent same-types (verified end-to-end including the
  slot 19 → slot 0 wrap)
- BA dominance preserved — song-naming density unchanged

## NanoClaw integration

**New group: `world_aside`** (separate history from `dashboard_main`
so producer-chat scrollback isn't polluted with world-search
transcripts). Lives at `nanoclaw-groups/world_aside/CLAUDE.md` in
this repo, ships into NanoClaw's `groups/world_aside/` on deploy.

**New auth file:** `groups/world_aside/.auth` (chmod 0600).
Single line: the Brave Search API key. NanoClaw reads it at tool
call time. **Same pattern as `dashboard_main` already uses for
`INTERNAL_API_SECRET`.** Important: trim CRLF when writing
(`tr -d '\r\n'`) — see HANDOFF.md note.

**New NanoClaw tool: `brave_search`**
Inside the group's tool config:

```json
{
  "name": "brave_search",
  "description": "Search the web via Brave. Use for one-line factual lookups: weather in named cities, recent music news, recent AI/tech news, on-this-day anniversaries, astronomical events. Returns top 3 results (title + snippet + age).",
  "implementation": "http",
  "url": "https://api.search.brave.com/res/v1/web/search",
  "headers": {
    "X-Subscription-Token": "<from .auth>",
    "Accept": "application/json"
  },
  "params": { "q": "{{query}}", "count": 3 }
}
```

**New HTTP endpoint on NanoClaw HttpChannel:**
`POST /world-aside/generate` (loopback only, guarded by
`INTERNAL_API_SECRET` like the chat endpoints).

Request:
```json
{ "show": "night_shift", "recentTopics": ["weather:lisbon", "music:billboard"] }
```

Response (success):
```json
{ "ok": true, "topic": "weather:tokyo", "line": "Tokyo's seeing rain right now. Quiet kind of weather — fits the hour." }
```

Response (no good topic / failure):
```json
{ "ok": false, "reason": "no_good_topic" | "brave_quota" | "search_failed" | "all_topics_recent" }
```

**Editorial briefing (`groups/world_aside/CLAUDE.md`)** — drives the
agent's behaviour:
- Topic categories + weights
- City list for weather: Lisbon, London, New York, Tokyo, Sydney
- Query templates per category
- Voice rules: same warmth-toward-listeners + banned phrases as
  auto-chatter (paste from `chatter-prompts.ts` BASE_SYSTEM)
- Refuse politics/war/disasters/religion/sports
- Output format: JSON `{ topic, line }`, max 200 chars, 1-2 sentences

**Topic identifier format:** `<category>:<subject-slug>`
- `weather:lisbon` / `weather:tokyo` / ...
- `music:taylor-swift-new-album` / `music:coachella-2026-lineup` / ...
- `ai:gpt5-released` / `ai:anthropic-research` / ...
- `on-this-day:1969-moon-landing` / ...
- `culture:netflix-thing-trending` / ...
- `astro:perseids-meteor-shower` / ...

The slug doesn't need to be deterministic — NanoClaw generates it,
queue-daemon stores it for anti-repeat. Loose match.

## Queue-daemon integration

**`chatter-prompts.ts`:**
- Add `"world_aside"` to `ChatterType` union
- Rewrite `ROTATION` constant per Section 2
- `promptFor("world_aside", ctx)` — throws (this type is externally
  supplied, never built locally)

**`station-config.ts`:** extend cached config shape:

```ts
interface StationConfig {
  autoHost: { mode, forcedUntil, forcedBy };
  worldAside: { mode, forcedUntil, forcedBy };  // NEW
}
```

Single Prisma fetch covers both blocks; same 10s TTL.

**`auto-host.ts:runChatter()`** — after `slotType` is resolved:

```ts
let script: string | null = null;
if (slotType === "world_aside") {
  const worldMode = config.worldAside.mode;
  if (worldMode === "forced_off") {
    slotType = "filler";  // demote, prompt MiniMax as filler
  } else {
    // auto or forced_on → ask NanoClaw
    try {
      const result = await this.deps.fetchWorldAside({
        show: currentShow,
        recentTopics: this.recentWorldTopics.snapshot(),
      });
      if (result.ok) {
        script = result.line;
        this.recentWorldTopics.push(result.topic);
      } else {
        this.deps.logFailure({ reason: `world_aside_${result.reason}` });
        slotType = "filler";  // graceful degradation
      }
    } catch (err) {
      this.deps.logFailure({ reason: "world_aside_http_error", detail: err.message });
      slotType = "filler";
    }
  }
}
// If script is null at this point → standard MiniMax prompt path.
// If script is set → skip MiniMax, go straight to TTS → upload → push.
```

**Anti-repeat memory:** in-process `RingBuffer<string>` of capacity
10. Survives only as long as the daemon process; on restart the
buffer empties. NanoClaw also has its own conversation history per
group, providing a softer second layer of repeat-avoidance across
restarts.

**`index.ts` wiring:**
- New dep `fetchWorldAside` added to AutoHostOrchestrator
- Implementation: `fetch("http://127.0.0.1:4001/world-aside/generate", { ... })`
  with a timeout (default 8s) + `INTERNAL_API_SECRET` header

**StationConfigCache `revertExpired` callback** extended to cover
both `autoHost*` and `worldAside*` columns. The atomic UPDATE
pattern stays the same.

## Topic catalog

**Categories + weights** (in NanoClaw briefing):

| Category    | Weight | Query template                             |
|-------------|--------|--------------------------------------------|
| weather     | 25%    | `"weather <city> today"` (city rotates)    |
| music       | 25%    | `"music news <YYYY-MM-DD>"`                |
| ai-tech     | 20%    | `"AI news <YYYY-MM-DD>"`                   |
| on-this-day | 15%    | `"<MMM DD> in music history"` or culture   |
| culture     | 10%    | `"trending culture <YYYY-MM-DD>"`          |
| astro       | 5%     | `"astronomical events <Month YYYY>"`       |

**Cities for weather (rotating):**
Lisbon, London, New York, Tokyo, Sydney.

Weighted-random pick. Anti-repeat layer kicks any topic identifier
present in `recentTopics` to a low weight (or filters entirely if
all categories are saturated → return `all_topics_recent`).

**Banned topic categories:** politics, war, disasters, religion,
sports, market/crypto prices, celebrity gossip. Briefing instructs
NanoClaw to refuse these even if a search returns them.

## Voice consistency

NanoClaw's `world_aside` briefing inherits Lena's full voice rules
from auto-chatter:
- Warm toward listeners ("glad you're tuned in"), never aloof
- Banned phrases (full set: "fine by me", "I don't mind", etc.)
- Max ~50 words, 1-2 sentences, max 200 characters
- No clock times ("4:13 AM" — bad)
- No real artist/track names (the catalogue can be referenced
  generically, but world_aside isn't about Numa's catalogue anyway)
- Output ONLY the line — no commentary, no prefix, no quotes

The same `BANNED_REGEX` from `context-line.ts` validates the
returned line server-side in queue-daemon as a defense layer. If
NanoClaw returns a banned phrase (rare with a good prompt, possible
with model drift), queue-daemon logs the failure and demotes the
slot to filler.

## Failure modes

| Scenario                          | Behaviour                                          |
|-----------------------------------|----------------------------------------------------|
| Toggle A forced_off               | Whole pipeline silent — no world either           |
| Toggle A auto, listeners < 5      | Silent (existing gate)                             |
| Toggle B forced_off               | Slot demotes to filler, MiniMax prompts as filler  |
| NanoClaw process down             | HTTP error → demote to filler, log + retry next slot |
| Brave API quota exhausted         | NanoClaw returns `brave_quota` → demote to filler  |
| Brave API down                    | NanoClaw returns `search_failed` → demote to filler |
| All categories recently used      | Returns `all_topics_recent` → demote to filler     |
| NanoClaw returns banned phrase    | Server-side validator catches → demote to filler   |
| NanoClaw returns over-length line | Truncate to 200 chars at last sentence boundary, log |
| Deepgram TTS fails                | Same as existing chatter — log + skip the slot     |

**No silence is acceptable** — every world_aside slot either fires
as world content or falls back to filler. Listeners always hear Lena
when auto-chatter would have spoken.

## Cost & rate

**Auto-chatter cadence at full pelt:** ~3 tracks × ~3 min = ~9 min
between voice breaks → ~160 chatter calls/day max.

**World cadence:** 3/20 of 160 = ~24 world_aside calls/day max.

**Brave budget:** 2000 searches/month ÷ 30 = ~66/day. World_aside
uses 1 Brave search per call → ~24/day → ~36% utilisation, 64%
headroom for retries on `no_good_topic` (NanoClaw may try a second
category if the first fails).

**MiniMax (NanoClaw brain):** ~24 calls/day × ~1500 tokens each =
~36k tokens/day. Trivial against the 1500/5h budget.

**Deepgram (TTS):** ~24 lines × ~150 chars = ~3.6k chars/day.
Within the existing chatter budget.

**B2 storage:** ~24 small MP3s/day. Negligible.

## Tests

- `chatter-prompts.test.ts` — extend rotation tests for new layout,
  assert no-adjacent-same-types and BA count preserved
- `station-config.test.ts` — extend for `worldAside.*` shape, assert
  cache TTL behaviour, assert revertExpired covers both blocks
- `auto-host.test.ts` — new tests:
  - world_aside slot, toggle B forced_off → demoted to filler
  - world_aside slot, NanoClaw returns ok → script used, MiniMax skipped
  - world_aside slot, NanoClaw returns no_good_topic → demoted
  - world_aside slot, NanoClaw HTTP throws → demoted
  - world_aside slot, NanoClaw returns banned phrase → demoted
  - recentWorldTopics ring buffer push + snapshot behaviour
- `world-aside-client.test.ts` (NEW) — small module wrapping the
  `fetchWorldAside` HTTP call. Test happy path, timeout, non-200, JSON
  parse failure, missing fields. All deps injectable.
- NanoClaw side: tool registration test, briefing rendered correctly,
  http-channel `/world-aside/generate` route happy path + auth gate

## Build sequence

1. **Spec** (this doc) ✓
2. Prisma migration `add_world_aside_mode`
3. `station-config.ts` extended shape + tests
4. `chatter-prompts.ts` new ROTATION + `world_aside` ChatterType + tests
5. `auto-host.ts` runChatter() world_aside branch + ring buffer + tests
6. `world-aside-client.ts` HTTP wrapper + tests
7. `index.ts` wire `fetchWorldAside` dep into orchestrator
8. NanoClaw side: new `world_aside` group folder + briefing,
   `brave_search` tool registration, `POST /world-aside/generate`
   HTTP endpoint, tests
9. Dashboard `/shoutouts` second segmented control + status row
10. `POST /api/shoutouts/world-chatter` API route
11. Operator-facing changes:
    - Add `BRAVE_API_KEY` line to `.env.local` example +
      `groups/world_aside/.auth` file template
    - HANDOFF.md update with deploy steps
12. Deploy:
    - `git pull` on Orion
    - `npx prisma migrate deploy`
    - Install Brave key into `nanoclaw/groups/world_aside/.auth`
    - Restart NanoClaw (`systemctl --user restart nanoclaw`)
    - Restart queue-daemon (`sudo systemctl restart numa-queue-daemon`)
    - Deploy dashboard (`cd dashboard && npm run deploy`)
    - Toggle World chatter to Auto on `/shoutouts`
13. Watch first ~30 min via `journalctl --user -u numa-queue-daemon
    -f | grep world_aside`. Expect ~3 successful asides per hour at
    full chatter pelt.

## Where the operator adds the Brave API key

Two locations, after deploy:

1. **NanoClaw side (primary):**
   ```
   echo -n "$BRAVE_KEY" > /home/marku/nanoclaw/groups/world_aside/.auth
   chmod 0600 /home/marku/nanoclaw/groups/world_aside/.auth
   ```
   This is what NanoClaw's `brave_search` tool reads at call time.

2. **`.env.local` (optional, for local script testing):**
   ```
   BRAVE_API_KEY=...
   ```
   Only used if you want to run a one-shot test script that bypasses
   NanoClaw. Production path is NanoClaw-only.

## Out of scope (deferred)

- Per-show topic preferences (e.g. Daylight Channel skips weather,
  Prime Hours skips on-this-day) — start uniform, tune later
- Operator override: "next world aside, talk about X" — could add a
  topicHint param later
- Topic feedback loop: track which topics earned listener votes
  (TrackVote) and weight upward — needs more data first
- Multi-language support — Lena is English-only for v1
- Real-time event surfacing (e.g. earthquake just happened) — out of
  scope by definition (politics/disasters)
- Listener-city-aware weather (geolocate Icecast IPs to pick which
  city's weather is mentioned) — privacy + complexity not worth it
  at current scale
