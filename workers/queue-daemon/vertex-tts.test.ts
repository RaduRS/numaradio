import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesizeVertex } from "./vertex-tts.ts";

function fakeClient(audioB64: string, mime = "audio/l16; rate=24000; channels=1") {
  const calls: { model: string; contents: unknown; config: unknown }[] = [];
  return {
    calls,
    models: {
      generateContent: async (req: { model: string; contents: unknown; config: unknown }) => {
        calls.push(req);
        return {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: mime, data: audioB64 } }],
              },
            },
          ],
        };
      },
    },
  };
}

const samplePcm = Buffer.from([0x00, 0x01, 0x02, 0x03]);
const sampleB64 = samplePcm.toString("base64");

const fakeMp3Encoder = async (pcm: Buffer) =>
  Buffer.concat([Buffer.from([0xff, 0xfb]), pcm]);

test("synthesizeVertex calls Gemini TTS with Leda voice", async () => {
  const client = fakeClient(sampleB64);
  await synthesizeVertex("Hello.", {
    project: "p",
    location: "global",
    client,
    pcmToMp3: fakeMp3Encoder,
  });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].model, "gemini-3.1-flash-tts-preview");
  const cfg = client.calls[0].config as Record<string, unknown>;
  assert.deepEqual(cfg.responseModalities, ["AUDIO"]);
  assert.deepEqual(cfg.speechConfig, {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Leda" } },
  });
});

test("synthesizeVertex returns MP3 buffer from encoded PCM", async () => {
  const client = fakeClient(sampleB64);
  const buf = await synthesizeVertex("Hi.", {
    project: "p",
    location: "global",
    client,
    pcmToMp3: fakeMp3Encoder,
  });
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xfb);
  assert.equal(buf.length, 2 + samplePcm.length);
});

test("synthesizeVertex passes pcm length to encoder", async () => {
  const client = fakeClient(sampleB64);
  let received: Buffer | null = null;
  await synthesizeVertex("Hi.", {
    project: "p",
    location: "global",
    client,
    pcmToMp3: async (pcm) => {
      received = pcm;
      return Buffer.from([0xff]);
    },
  });
  assert.ok(received);
  assert.equal(received!.length, samplePcm.length);
});

test("synthesizeVertex throws on empty text", async () => {
  await assert.rejects(
    () =>
      synthesizeVertex("", {
        project: "p",
        location: "global",
        client: fakeClient(sampleB64),
        pcmToMp3: fakeMp3Encoder,
      }),
    /empty text/i,
  );
});

test("synthesizeVertex throws when response has no audio", async () => {
  const client = {
    models: {
      generateContent: async () => ({ candidates: [{ content: { parts: [] } }] }),
    },
  };
  await assert.rejects(
    () =>
      synthesizeVertex("Hi.", {
        project: "p",
        location: "global",
        client,
        pcmToMp3: fakeMp3Encoder,
      }),
    /no audio/i,
  );
});

test("synthesizeVertex throws when project is missing", async () => {
  await assert.rejects(
    () =>
      synthesizeVertex("Hi.", {
        project: "",
        location: "global",
        client: fakeClient(sampleB64),
        pcmToMp3: fakeMp3Encoder,
      }),
    /GOOGLE_CLOUD_PROJECT/,
  );
});

test("synthesizeVertex propagates SDK errors", async () => {
  const client = {
    models: {
      generateContent: async () => {
        throw new Error("403 PERMISSION_DENIED");
      },
    },
  };
  await assert.rejects(
    () =>
      synthesizeVertex("Hi.", {
        project: "p",
        location: "global",
        client,
        pcmToMp3: fakeMp3Encoder,
      }),
    /vertex 403|PERMISSION_DENIED/,
  );
});
