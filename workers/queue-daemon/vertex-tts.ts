import { spawn } from "node:child_process";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.1-flash-tts-preview";
const VOICE = "Leda";
const SAMPLE_RATE = 24000;

export interface VertexClient {
  models: {
    generateContent: (req: {
      model: string;
      contents: unknown;
      config: unknown;
    }) => Promise<{
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
      }>;
    }>;
  };
}

export interface VertexOpts {
  project: string;
  location?: string;
  client?: VertexClient;
  pcmToMp3?: (pcm: Buffer, sampleRate: number) => Promise<Buffer>;
}

export async function synthesizeVertex(
  text: string,
  opts: VertexOpts,
): Promise<Buffer> {
  if (!opts.project) throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  if (!text.trim()) throw new Error("empty text");

  const client =
    opts.client ??
    (new GoogleGenAI({
      vertexai: true,
      project: opts.project,
      location: opts.location ?? "global",
    }) as unknown as VertexClient);
  const encoder = opts.pcmToMp3 ?? defaultPcmToMp3;

  let res: Awaited<ReturnType<VertexClient["models"]["generateContent"]>>;
  try {
    res = await client.models.generateContent({
      model: MODEL,
      contents: text,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
        },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`vertex ${msg.slice(0, 200)}`);
  }

  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  const b64 = part?.inlineData?.data;
  if (!b64) throw new Error("vertex returned no audio");

  const pcm = Buffer.from(b64, "base64");
  return encoder(pcm, SAMPLE_RATE);
}

function defaultPcmToMp3(pcm: Buffer, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        String(sampleRate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => errChunks.push(c));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) {
        const err = Buffer.concat(errChunks).toString("utf8");
        reject(new Error(`ffmpeg exit ${code}: ${err.slice(0, 200)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.end(pcm);
  });
}
