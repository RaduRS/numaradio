import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContextLineOrchestrator,
  buildPrompt,
  extractNumericalClaims,
  showForHour,
  shiftStart,
  validateContextLine,
  validateNumericalClaims,
  type ContextLineDeps,
  type StationState,
} from "./context-line.ts";

const baseState: StationState = {
  show: "night_shift",
  hourOfShift: 2,
  shoutoutsLast10Min: 3,
  shoutoutsLast30Min: 7,
  songRequestsLastHour: 1,
  songRequestsThisShift: 4,
  tracksAiredThisShift: 24,
  freshTracksLast24h: 12,
  topGenreLastHour: "ambient",
  votesUpLast30Min: 8,
  votesDownLast30Min: 1,
  recentShoutoutSamples: ["happy birthday to my mum", "rainy lisbon vibe"],
};

// ─── extractNumericalClaims ─────────────────────────────────────────

test("extractNumericalClaims: digits + word numbers, deduped + sorted", () => {
  const claims = extractNumericalClaims("Three of you wrote and 47 songs aired");
  assert.deepEqual(claims, [3, 47]);
});

test("extractNumericalClaims: hyphenated word numbers", () => {
  const claims = extractNumericalClaims("forty-seven songs since the start");
  assert.deepEqual(claims, [47]);
});

test("extractNumericalClaims: empty when no claims", () => {
  assert.deepEqual(extractNumericalClaims("It's quiet here, the way I like it."), []);
});

// ─── validateNumericalClaims ────────────────────────────────────────

test("validateNumericalClaims: claim matches a state field → ok", () => {
  const result = validateNumericalClaims(
    "Three of you wrote in the last ten minutes.",
    baseState,
  );
  assert.equal(result.ok, true);
});

test("validateNumericalClaims: claim with no matching state → fail", () => {
  const result = validateNumericalClaims(
    "Forty-seven songs since midnight here.",
    baseState,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /numerical_claim_unsupported:47/);
  }
});

test("validateNumericalClaims: small numbers (1, 2) are not enforced", () => {
  // Lena often says "for a moment", "one of those nights" — these are
  // grammatical, not factual claims. We only enforce ≥3.
  const result = validateNumericalClaims(
    "Just one of those hours when nothing's moving.",
    baseState,
  );
  assert.equal(result.ok, true);
});

test("validateNumericalClaims: any-of match across state fields", () => {
  // 24 matches tracksAiredThisShift in baseState
  const result = validateNumericalClaims("Twenty-four songs in already.", baseState);
  assert.equal(result.ok, true);
});

// ─── validateContextLine ────────────────────────────────────────────

test("validateContextLine: empty rejected", () => {
  const r = validateContextLine("", baseState);
  assert.equal(r.ok, false);
});

test("validateContextLine: too-long rejected", () => {
  const long = "a".repeat(201);
  const r = validateContextLine(long, baseState);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /^length_/);
});

test("validateContextLine: banned phrase rejected", () => {
  const r = validateContextLine("As an AI, the rotation feels good.", baseState);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "banned_phrase");
});

test("validateContextLine: rejects 'fine by me' / aloof phrasing toward listeners", () => {
  // Lena warms toward listeners — she never shrugs off a quiet wall.
  for (const aloof of [
    "The wall just went quiet again. Fine by me.",
    "Quiet hour on the line. I don't mind.",
    "Wall's slow. Doesn't bother me either way.",
  ]) {
    const r = validateContextLine(aloof, baseState);
    assert.equal(r.ok, false, `expected ban for: ${aloof}`);
    if (!r.ok) assert.equal(r.reason, "banned_phrase");
  }
});

test("validateContextLine: clock time rejected", () => {
  const r = validateContextLine("It's 4:13 AM here and the wall is quiet.", baseState);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "clock_time");
});

test("validateContextLine: happy path passes", () => {
  const r = validateContextLine(
    "Three of you wrote in the last ten minutes. The wall has a shape tonight.",
    baseState,
  );
  assert.equal(r.ok, true);
});

test("validateContextLine: false numerical claim rejected", () => {
  const r = validateContextLine(
    "A hundred of you sent shoutouts already.",
    baseState,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /numerical_claim_unsupported:100/);
});

// ─── buildPrompt ────────────────────────────────────────────────────

test("buildPrompt: trims null fields from JSON", () => {
  const state: StationState = {
    ...baseState,
    topGenreLastHour: null,
    recentShoutoutSamples: [],
  };
  const prompts = buildPrompt(state);
  assert.ok(!prompts.user.includes("topGenreLastHour"));
  assert.ok(!prompts.user.includes("recentShoutoutSamples"));
});

test("buildPrompt: never includes a listener count (intentionally omitted from state)", () => {
  const prompts = buildPrompt(baseState);
  // No matter what state holds, listener count must NOT reach the model —
  // it goes stale faster than Lena's quote refreshes.
  assert.ok(!prompts.user.includes("currentListeners"));
  assert.ok(!prompts.user.includes("listeners"));
});

test("buildPrompt: includes numeric state fields", () => {
  const prompts = buildPrompt(baseState);
  assert.ok(prompts.user.includes('"shoutoutsLast30Min": 7'));
  assert.ok(prompts.user.includes('"tracksAiredThisShift": 24'));
});

test("buildPrompt: includes show label", () => {
  const prompts = buildPrompt({ ...baseState, show: "prime_hours" });
  assert.ok(prompts.user.includes("Prime Hours"));
});

// ─── showForHour / shiftStart ───────────────────────────────────────

test("showForHour: matches the station schedule", () => {
  assert.equal(showForHour(0), "night_shift");
  assert.equal(showForHour(4), "night_shift");
  assert.equal(showForHour(5), "morning_room");
  assert.equal(showForHour(9), "morning_room");
  assert.equal(showForHour(10), "daylight_channel");
  assert.equal(showForHour(16), "daylight_channel");
  assert.equal(showForHour(17), "prime_hours");
  assert.equal(showForHour(23), "prime_hours");
});

test("shiftStart: anchors to shift boundary at 0 minutes", () => {
  const now = new Date(2026, 3, 26, 19, 47, 33);
  const start = shiftStart(now);
  assert.equal(start.getHours(), 17);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
});

// ─── ContextLineOrchestrator ────────────────────────────────────────

interface SpyLog {
  successes: string[];
  failures: { reason: string; detail?: string }[];
  persisted: string[];
}

function makeSpy(): SpyLog {
  return { successes: [], failures: [], persisted: [] };
}

function makeDeps(
  spy: SpyLog,
  overrides: Partial<ContextLineDeps>,
): ContextLineDeps {
  return {
    fetchStationState: async () => baseState,
    generateLine: async () => "The wall has a shape tonight.",
    persistLine: async (s) => {
      spy.persisted.push(s);
    },
    logSuccess: (s) => {
      spy.successes.push(s);
    },
    logFailure: (reason, detail) => {
      spy.failures.push({ reason, detail });
    },
    ...overrides,
  };
}

test("orchestrator: happy path persists + logs success", async () => {
  const spy = makeSpy();
  const orch = new ContextLineOrchestrator(makeDeps(spy, {}));
  await orch.runOnce();
  assert.equal(spy.successes.length, 1);
  assert.equal(spy.failures.length, 0);
  assert.equal(spy.persisted.length, 1);
  assert.equal(spy.persisted[0], "The wall has a shape tonight.");
});

test("orchestrator: trims smart quotes around model output", async () => {
  const spy = makeSpy();
  const orch = new ContextLineOrchestrator(
    makeDeps(spy, {
      generateLine: async () => '"The wall has a shape tonight."',
    }),
  );
  await orch.runOnce();
  assert.equal(spy.persisted[0], "The wall has a shape tonight.");
});

test("orchestrator: state fetch failure logs + skips", async () => {
  const spy = makeSpy();
  const orch = new ContextLineOrchestrator(
    makeDeps(spy, {
      fetchStationState: async () => {
        throw new Error("neon down");
      },
    }),
  );
  await orch.runOnce();
  assert.equal(spy.successes.length, 0);
  assert.equal(spy.persisted.length, 0);
  assert.equal(spy.failures[0].reason, "fetch_state_failed");
  assert.match(spy.failures[0].detail ?? "", /neon down/);
});

test("orchestrator: generation failure logs + skips", async () => {
  const spy = makeSpy();
  const orch = new ContextLineOrchestrator(
    makeDeps(spy, {
      generateLine: async () => {
        throw new Error("minimax 503");
      },
    }),
  );
  await orch.runOnce();
  assert.equal(spy.persisted.length, 0);
  assert.equal(spy.failures[0].reason, "generate_failed");
});

test("orchestrator: invalid line is dropped before persist", async () => {
  const spy = makeSpy();
  const orch = new ContextLineOrchestrator(
    makeDeps(spy, {
      // 47 songs — but state has 24 tracks aired, so 47 is unsupported.
      generateLine: async () => "Forty-seven songs since midnight here.",
    }),
  );
  await orch.runOnce();
  assert.equal(spy.persisted.length, 0);
  assert.equal(spy.successes.length, 0);
  assert.equal(spy.failures[0].reason, "validation_failed");
});

test("orchestrator: persist failure logs + does not log success", async () => {
  const spy = makeSpy();
  const orch = new ContextLineOrchestrator(
    makeDeps(spy, {
      persistLine: async () => {
        throw new Error("prisma boom");
      },
    }),
  );
  await orch.runOnce();
  assert.equal(spy.successes.length, 0);
  assert.equal(spy.failures[0].reason, "persist_failed");
});
