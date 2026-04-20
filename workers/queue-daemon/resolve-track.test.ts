import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTrackIdFromUrl, resolveTrackId } from "./resolve-track.ts";

test("extractTrackIdFromUrl pulls the id from a /tracks/<id>/audio/ path", () => {
  const url = "https://f003.backblazeb2.com/file/numaradio/stations/numaradio/tracks/cmo5o2tsa0002wey8w4398pge/audio/stream.mp3";
  assert.equal(extractTrackIdFromUrl(url), "cmo5o2tsa0002wey8w4398pge");
});

test("extractTrackIdFromUrl returns null on non-track paths", () => {
  assert.equal(extractTrackIdFromUrl("https://example.com/foo.mp3"), null);
  assert.equal(extractTrackIdFromUrl(""), null);
});

test("resolveTrackId prefers explicit trackId when valid", async () => {
  const lookup = {
    byId: async (id: string) => (id === "real" ? { id: "real", stationId: "s1" } : null),
    byTitleArtist: async () => null,
  };
  const got = await resolveTrackId({ trackId: "real" }, lookup);
  assert.equal(got?.id, "real");
});

test("resolveTrackId falls back to URL extraction when trackId missing", async () => {
  const lookup = {
    byId: async (id: string) => (id === "extracted" ? { id: "extracted", stationId: "s1" } : null),
    byTitleArtist: async () => null,
  };
  const got = await resolveTrackId(
    { sourceUrl: "https://x/tracks/extracted/audio/y.mp3" },
    lookup,
  );
  assert.equal(got?.id, "extracted");
});

test("resolveTrackId falls back to title+artist lookup last", async () => {
  const lookup = {
    byId: async () => null,
    byTitleArtist: async (title: string, artist: string | undefined) =>
      title === "T" && artist === "A" ? { id: "ta", stationId: "s1" } : null,
  };
  const got = await resolveTrackId({ title: "T", artist: "A" }, lookup);
  assert.equal(got?.id, "ta");
});

test("resolveTrackId returns null when nothing matches", async () => {
  const lookup = {
    byId: async () => null,
    byTitleArtist: async () => null,
  };
  assert.equal(await resolveTrackId({ title: "nope" }, lookup), null);
});
