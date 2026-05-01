import { synthesizeChatter } from "./deepgram-tts.ts";
import { synthesizeVertex } from "./vertex-tts.ts";
import type { VoiceProvider } from "./station-config.ts";

export interface SynthRouterOpts {
  getProvider: () => Promise<VoiceProvider>;
  deepgramKey: string;
  vertexProject: string;
  vertexLocation?: string;
  /** Override for tests. */
  deepgramSynth?: (text: string) => Promise<Buffer>;
  /** Override for tests. */
  vertexSynth?: (text: string) => Promise<Buffer>;
}

/** Returns a single `synthesize(text)` function that picks the active
 *  provider per call. Vertex failures auto-fall-back to Deepgram so a
 *  transient Vertex outage never silences Lena. */
export function createSynthesizer(
  opts: SynthRouterOpts,
): (text: string) => Promise<Buffer> {
  const dg =
    opts.deepgramSynth ??
    ((text: string) => synthesizeChatter(text, { apiKey: opts.deepgramKey }));
  const vx =
    opts.vertexSynth ??
    ((text: string) =>
      synthesizeVertex(text, {
        project: opts.vertexProject,
        location: opts.vertexLocation,
      }));

  return async (text: string) => {
    let provider: VoiceProvider;
    try {
      provider = await opts.getProvider();
    } catch (err) {
      console.warn(
        "[synth-router] provider lookup failed, falling back to deepgram:",
        err instanceof Error ? err.message : err,
      );
      provider = "deepgram";
    }

    if (provider === "vertex") {
      try {
        return await vx(text);
      } catch (err) {
        console.warn(
          "[synth-router] vertex failed, falling back to deepgram:",
          err instanceof Error ? err.message : err,
        );
        return await dg(text);
      }
    }
    return dg(text);
  };
}
