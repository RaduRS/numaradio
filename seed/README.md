# seed/

Drop seed-library audio (MP3/WAV) here. Files in this folder are gitignored —
they get uploaded to B2 by `npm run ingest:seed` and never live in the repo.

## Per-song input formats (any of these, in order of precedence)

For each song you can provide metadata three ways. The ingest script tries them in
this order and uses whichever it finds first:

1. **JSON sidecar** — `slow-fade-brighter.json` next to `slow-fade-brighter.mp3`:
   ```json
   {
     "title": "Slow Fade, Brighter",
     "artist": "Russell Ross",
     "mood": "ambient",
     "genre": "downtempo",
     "sourceUrl": "https://suno.com/song/..."
   }
   ```
2. **URL list** — a single `urls.txt` file in this folder, one Suno URL per line.
   The script will fetch each, scrape title + tags + artwork, and download the MP3
   from the URL itself (no need for a local file in this case).
3. **ID3 tags** embedded in the MP3 — title/artist/genre extracted automatically.
4. **Filename fallback** — `slow-fade-brighter.mp3` becomes title `"Slow Fade Brighter"`.

If no artwork is provided anywhere, a gradient placeholder is generated based on
the track title initials (matches the design's `q-art` blocks).
