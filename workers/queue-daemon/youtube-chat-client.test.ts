import { test } from "node:test";
import assert from "node:assert/strict";
import { createYoutubeChatClient } from "./youtube-chat-client.ts";

// ─── Test harness ──────────────────────────────────────────────────────

interface Call {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

function makeFetcher(
  responses: Array<{ status?: number; json?: unknown; text?: string }>,
) {
  const calls: Call[] = [];
  let i = 0;
  const fetcher: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    const r = responses[i++] ?? { status: 200, json: {} };
    return new Response(
      r.text ?? JSON.stringify(r.json ?? {}),
      { status: r.status ?? 200 },
    );
  }) as typeof fetch;
  return { fetcher, calls };
}

const baseOpts = {
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rtok",
};

// ─── findActiveLiveChatId ──────────────────────────────────────────────

test("findActiveLiveChatId returns the chat ID for the active broadcast", async () => {
  const { fetcher, calls } = makeFetcher([
    { json: { access_token: "at1", expires_in: 3600 } }, // oauth
    {
      json: {
        items: [
          { id: "vid1", snippet: { liveChatId: "chatABC" } },
        ],
      },
    },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  const id = await c.findActiveLiveChatId();
  assert.equal(id, "chatABC");
  // OAuth call + 1 broadcasts.list call.
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /liveBroadcasts/);
  assert.match(calls[1].url, /broadcastStatus=active/);
  // YouTube API rejects mine + broadcastStatus together; OAuth token
  // already scopes to the user's channel.
  assert.doesNotMatch(calls[1].url, /mine=true/);
});

test("findActiveLiveChatId returns null when nothing is live", async () => {
  const { fetcher } = makeFetcher([
    { json: { access_token: "at1", expires_in: 3600 } },
    { json: { items: [] } },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  const id = await c.findActiveLiveChatId();
  assert.equal(id, null);
});

test("findActiveLiveChatId caches across calls", async () => {
  const { fetcher, calls } = makeFetcher([
    { json: { access_token: "at1", expires_in: 3600 } },
    {
      json: {
        items: [{ id: "vid1", snippet: { liveChatId: "chatABC" } }],
      },
    },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  await c.findActiveLiveChatId();
  await c.findActiveLiveChatId();
  // Second call should not re-hit the API.
  assert.equal(calls.length, 2);
});

test("reset() clears the cached liveChatId", async () => {
  const { fetcher, calls } = makeFetcher([
    { json: { access_token: "at1", expires_in: 3600 } },
    { json: { items: [{ id: "vid1", snippet: { liveChatId: "chat1" } }] } },
    { json: { items: [{ id: "vid2", snippet: { liveChatId: "chat2" } }] } },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  assert.equal(await c.findActiveLiveChatId(), "chat1");
  c.reset();
  assert.equal(await c.findActiveLiveChatId(), "chat2");
  assert.equal(calls.length, 3);
});

// ─── fetchNewMessages ──────────────────────────────────────────────────

test("first fetchNewMessages call returns no messages (drops backlog)", async () => {
  const { fetcher } = makeFetcher([
    { json: { access_token: "at", expires_in: 3600 } },
    {
      json: {
        items: [
          {
            id: "m1",
            snippet: {
              type: "textMessageEvent",
              publishedAt: "2026-04-28T10:00:00Z",
              textMessageDetails: { messageText: "hello" },
            },
            authorDetails: { displayName: "Alice", channelId: "UCalice" },
          },
        ],
        nextPageToken: "tok2",
        pollingIntervalMillis: 5000,
      },
    },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  const r = await c.fetchNewMessages("chatX");
  // First call drops backlog so the daemon doesn't air messages from
  // before it was running.
  assert.deepEqual(r.messages, []);
  assert.equal(r.pollingIntervalMs, 5000);
});

test("subsequent fetchNewMessages forwards new messages with pagination", async () => {
  const { fetcher, calls } = makeFetcher([
    { json: { access_token: "at", expires_in: 3600 } },
    // First poll — drops backlog, returns nextPageToken.
    {
      json: {
        items: [{ id: "m0", snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "old" } }, authorDetails: { displayName: "Old", channelId: "UCold" } }],
        nextPageToken: "tok1",
        pollingIntervalMillis: 5000,
      },
    },
    // Second poll — returns a new message after tok1.
    {
      json: {
        items: [
          {
            id: "m1",
            snippet: {
              type: "textMessageEvent",
              publishedAt: "2026-04-28T10:01:00Z",
              textMessageDetails: { messageText: "first real one" },
            },
            authorDetails: {
              displayName: "Alice",
              channelId: "UCalice",
              isChatOwner: false,
              isChatModerator: false,
            },
          },
        ],
        nextPageToken: "tok2",
        pollingIntervalMillis: 5000,
      },
    },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  await c.fetchNewMessages("chatX"); // primes
  const r = await c.fetchNewMessages("chatX");

  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].id, "m1");
  assert.equal(r.messages[0].text, "first real one");
  assert.equal(r.messages[0].authorName, "Alice");
  assert.equal(r.messages[0].authorChannelId, "UCalice");
  assert.equal(r.messages[0].isChannelOwner, false);
  assert.equal(r.messages[0].isModerator, false);
  // Second poll should pass pageToken=tok1.
  const secondPoll = calls[2];
  assert.match(secondPoll.url, /pageToken=tok1/);
});

test("fetchNewMessages skips non-text events (joins, superchats)", async () => {
  const { fetcher } = makeFetcher([
    { json: { access_token: "at", expires_in: 3600 } },
    { json: { items: [], nextPageToken: "tok1", pollingIntervalMillis: 5000 } },
    {
      json: {
        items: [
          {
            id: "j1",
            snippet: { type: "newSponsorEvent" },
            authorDetails: { displayName: "Bob", channelId: "UCbob" },
          },
          {
            id: "s1",
            snippet: { type: "superChatEvent" },
            authorDetails: { displayName: "Carol", channelId: "UCcarol" },
          },
          {
            id: "t1",
            snippet: {
              type: "textMessageEvent",
              textMessageDetails: { messageText: "real msg" },
            },
            authorDetails: { displayName: "Dave", channelId: "UCdave" },
          },
        ],
      },
    },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  await c.fetchNewMessages("chatX"); // primes
  const r = await c.fetchNewMessages("chatX");
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].id, "t1");
});

test("fetchNewMessages skips empty / whitespace-only messages", async () => {
  const { fetcher } = makeFetcher([
    { json: { access_token: "at", expires_in: 3600 } },
    { json: { items: [], nextPageToken: "tok1" } },
    {
      json: {
        items: [
          { id: "e1", snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "   " } }, authorDetails: { displayName: "X", channelId: "UCx" } },
          { id: "e2", snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "" } }, authorDetails: { displayName: "Y", channelId: "UCy" } },
          { id: "e3", snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "real" } }, authorDetails: { displayName: "Z", channelId: "UCz" } },
        ],
      },
    },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  await c.fetchNewMessages("chatX");
  const r = await c.fetchNewMessages("chatX");
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].id, "e3");
});

test("fetchNewMessages flags channel-owner + moderator authors", async () => {
  const { fetcher } = makeFetcher([
    { json: { access_token: "at", expires_in: 3600 } },
    { json: { items: [], nextPageToken: "tok1" } },
    {
      json: {
        items: [
          {
            id: "o1",
            snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "owner msg" } },
            authorDetails: { displayName: "Owner", channelId: "UCowner", isChatOwner: true },
          },
          {
            id: "mod1",
            snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "mod msg" } },
            authorDetails: { displayName: "Mod", channelId: "UCmod", isChatModerator: true },
          },
        ],
      },
    },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  await c.fetchNewMessages("chatX");
  const r = await c.fetchNewMessages("chatX");
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[0].isChannelOwner, true);
  assert.equal(r.messages[1].isModerator, true);
});

test("fetchNewMessages enforces 5s minimum polling interval", async () => {
  const { fetcher } = makeFetcher([
    { json: { access_token: "at", expires_in: 3600 } },
    { json: { items: [], pollingIntervalMillis: 1000 } },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  const r = await c.fetchNewMessages("chatX");
  // YouTube said 1s, we floor at 5s to be quota-friendly.
  assert.equal(r.pollingIntervalMs, 5000);
});

// ─── OAuth ──────────────────────────────────────────────────────────────

test("OAuth refresh failure surfaces a clear error", async () => {
  const { fetcher } = makeFetcher([
    { status: 401, text: "invalid_grant" },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  await assert.rejects(
    () => c.findActiveLiveChatId(),
    /oauth refresh 401/,
  );
});

test("OAuth caches token across API calls", async () => {
  const { fetcher, calls } = makeFetcher([
    { json: { access_token: "at1", expires_in: 3600 } },
    { json: { items: [{ id: "v", snippet: { liveChatId: "c" } }] } },
    { json: { items: [], nextPageToken: "tok1" } },
  ]);
  const c = createYoutubeChatClient({ ...baseOpts, fetcher });
  await c.findActiveLiveChatId();
  await c.fetchNewMessages("c");
  // Only 1 OAuth call (calls[0]) for 2 API calls.
  assert.equal(calls.filter((x) => x.url.includes("oauth2.googleapis.com")).length, 1);
});
