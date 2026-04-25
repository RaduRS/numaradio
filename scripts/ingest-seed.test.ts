import { test } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseShowHashtag, resolveShowFromHashtagOrSidecar } from "./ingest-seed-helpers.ts";

test("parseShowHashtag finds #NightShift", () => {
  assert.equal(parseShowHashtag("Vibes #NightShift #Calm"), "night_shift");
});
test("parseShowHashtag finds #MorningRoom", () => {
  assert.equal(parseShowHashtag("hello #MorningRoom"), "morning_room");
});
test("parseShowHashtag finds #DaylightChannel", () => {
  assert.equal(parseShowHashtag("#DaylightChannel"), "daylight_channel");
});
test("parseShowHashtag finds #PrimeHours", () => {
  assert.equal(parseShowHashtag("late night vibe #PrimeHours"), "prime_hours");
});
test("parseShowHashtag returns null when missing", () => {
  assert.equal(parseShowHashtag("no show tag here #NuDisco #Groovy"), null);
});

test("resolveShowFromHashtagOrSidecar prefers hashtag", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seed-test-"));
  const mp3 = join(dir, "song.mp3");
  await writeFile(mp3, Buffer.from("fake"));
  await writeFile(`${mp3}.show`, "prime_hours");
  const r = await resolveShowFromHashtagOrSidecar({
    mp3Path: mp3, commentText: "comment with #MorningRoom",
  });
  assert.equal(r, "morning_room");
  await rm(dir, { recursive: true });
});

test("resolveShowFromHashtagOrSidecar falls back to sidecar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seed-test-"));
  const mp3 = join(dir, "song.mp3");
  await writeFile(mp3, Buffer.from("fake"));
  await writeFile(`${mp3}.show`, "night_shift\n");
  const r = await resolveShowFromHashtagOrSidecar({
    mp3Path: mp3, commentText: "no hashtag here",
  });
  assert.equal(r, "night_shift");
  await rm(dir, { recursive: true });
});

test("resolveShowFromHashtagOrSidecar throws when neither present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seed-test-"));
  const mp3 = join(dir, "song.mp3");
  await writeFile(mp3, Buffer.from("fake"));
  await assert.rejects(
    resolveShowFromHashtagOrSidecar({ mp3Path: mp3, commentText: "no tag" }),
    /must include a show hashtag/i,
  );
  await rm(dir, { recursive: true });
});
