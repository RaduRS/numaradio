import "../lib/load-env";
import { GoogleGenAI } from "@google/genai";
import { writeFileSync } from "node:fs";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "numa-radio-dashboard-494716";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const MODEL = process.env.VERTEX_TTS_MODEL || "gemini-3.1-flash-tts-preview";
const VOICE = process.env.VERTEX_TTS_VOICE || "Leda";
const TEXT =
  "Hi, you're tuned in to Numa Radio. The station that never sleeps.";
const OUT = process.argv[2] || "/mnt/c/Users/marku/Desktop/numa-vertex-test.wav";

async function main() {
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });

console.log(`[vertex-tts] project=${PROJECT} location=${LOCATION}`);
console.log(`[vertex-tts] model=${MODEL} voice=${VOICE}`);
console.log(`[vertex-tts] text=${JSON.stringify(TEXT)}`);

const res = await ai.models.generateContent({
  model: MODEL,
  contents: TEXT,
  config: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
    },
  },
});

const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!part?.inlineData?.data) {
  console.error("[vertex-tts] no audio in response", JSON.stringify(res, null, 2));
  process.exit(1);
}

const pcm = Buffer.from(part.inlineData.data, "base64");
const sampleRate = 24000;
const channels = 1;
const bitsPerSample = 16;
const byteRate = (sampleRate * channels * bitsPerSample) / 8;
const blockAlign = (channels * bitsPerSample) / 8;
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(byteRate, 28);
header.writeUInt16LE(blockAlign, 32);
header.writeUInt16LE(bitsPerSample, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([header, pcm]);
writeFileSync(OUT, wav);
console.log(`[vertex-tts] wrote ${wav.length} bytes → ${OUT}`);
console.log(`[vertex-tts] mime=${part.inlineData.mimeType ?? "(unset)"}`);
const audioSec = pcm.length / (24000 * 2);
console.log(`[vertex-tts] audio=${audioSec.toFixed(2)}s`);
console.log(`[vertex-tts] usage=${JSON.stringify(res.usageMetadata)}`);
}

main().catch((e) => {
  console.error("[vertex-tts] error:", e?.message || e);
  process.exit(1);
});
