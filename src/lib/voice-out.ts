/* ============================================================
 * VoiceOut — deterministic voice delivery for chat channels
 *
 * Problem this solves: voice-out used to depend entirely on model
 * cooperation (call the tts tool, then repeat a "🎙 voice note: URL"
 * line verbatim). Models instead hallucinate pseudo-protocols like
 * <tts>...</tts> and CLAIM they sent audio — the user gets text with
 * leaked tags. This layer makes voice delivery deterministic:
 *
 *   1. extractVoiceBlocks()  — any <tts>/<voice>/<audio> block the
 *      model emits is parsed out of the reply and turned into a REAL
 *      voice note (the hallucinated protocol comes true), tags never
 *      leak into the chat text
 *   2. mdToSpeechText()      — markdown → speakable prose
 *   3. synthesizeVoice()     — keyless-tolerant TTS chain:
 *      z-ai SDK audio.tts → msedge-tts (no API key, works on any host)
 *
 * The gateway (telegram.ts) layers "voice mirror" on top: when the
 * user talks via voice note, the reply is spoken back automatically.
 * ============================================================ */

export type VoiceOutMode = "auto" | "on" | "off";

/* ---------------- 1. voice-block extraction ---------------- */

/** All tag dialects the model might hallucinate for voice delivery. */
const VOICE_BLOCK_RE =
  /<(tts|voice|audio|speak|text_to_speech)\s*>([\s\S]*?)<\/\s*\1\s*>/gi;
/** Opening/closing voice tags that never found a pair — always stripped. */
const STRAY_VOICE_TAG_RE =
  /<\/?\s*(tts|voice|audio|speak|text_to_speech)\s*\/?>/gi;

export interface ExtractedVoice {
  /** reply text with voice blocks and stray tags removed */
  text: string;
  /** inner text of each voice block, in order — each becomes a voice note */
  voiceTexts: string[];
}

/**
 * Pull every <tts>/<voice>/<audio>/<speak>/<text_to_speech> block out of a
 * model reply. The block's inner text becomes a voice note; the visible
 * text never contains the tags. Unpaired stray tags are stripped too.
 */
export function extractVoiceBlocks(md: string): ExtractedVoice {
  const voiceTexts: string[] = [];
  const text = md
    .replace(VOICE_BLOCK_RE, (_m, _tag: string, inner: string) => {
      const t = inner.replace(STRAY_VOICE_TAG_RE, "").trim();
      if (t) voiceTexts.push(t);
      return "";
    })
    .replace(STRAY_VOICE_TAG_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
  return { text, voiceTexts };
}

/* ---------------- 2. markdown → speakable prose ---------------- */

/** Approximate spoken length cap; longer answers get an audible pointer. */
const SPEECH_CAP = 3_600;

/**
 * Markdown → natural prose for TTS: code blocks/inline code are summarized,
 * images/links collapse to their labels, emphasis/entity noise is stripped.
 */
export function mdToSpeechText(md: string): string {
  let t = md;

  // code fences → spoken summary (the full code is in the text message)
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => {
    const lines = code.trim().split("\n").length;
    return lines > 1 ? `(code block, ${lines} lines — see the text message)` : "(short code snippet — see the text message)";
  });
  // images → drop (alt text is usually noise when spoken)
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `${alt} (image)` : ""));
  // links → label (URLs are unreadable when spoken)
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // bare URLs → drop (unreadable aloud)
  t = t.replace(/https?:\/\/\S+/g, "link");
  // inline code → plain
  t = t.replace(/`([^`]+)`/g, "$1");
  // headings / list markers / blockquotes → plain prose
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s*[-*•]\s+/gm, "");
  t = t.replace(/^\s*>\s?/gm, "");
  // emphasis markers
  t = t.replace(/(\*\*|__|\*|_|~~)/g, "");
  // tables → drop separator rows, keep cell text
  t = t.replace(/^\s*\|?[-:|][-:|\s]*\|?\s*$/gm, "");
  t = t.replace(/\|/g, ", ");
  // collapse whitespace
  t = t.replace(/\n{2,}/g, ".\n").replace(/[ \t]+/g, " ").trim();

  if (t.length > SPEECH_CAP) {
    const cut = t.slice(0, SPEECH_CAP);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    t = (lastStop > SPEECH_CAP * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim();
    t += "\n... the full answer is in the text message.";
  }
  return t;
}

/* ---------------- 3. TTS synthesis (fallback chain) ---------------- */

export interface SynthResult {
  ok: boolean;
  bytes?: Uint8Array;
  via?: string;
  error?: string;
}

/** z-ai SDK tier — best quality voices, needs cloud reachability.
 *  SDK quirk (probed live): create() returns a raw Response object and the
 *  endpoint only accepts response_format "wav" (mp3/ogg/opus → HTTP 400). */
async function synthViaZai(text: string): Promise<SynthResult> {
  try {
    const { getZAI } = await import("./zai");
    const zai = await getZAI();
    const r = (await zai.audio.tts.create({
      input: text.slice(0, 4000),
      response_format: "wav",
    })) as unknown;
    let bytes: Uint8Array | null = null;
    if (typeof Response !== "undefined" && r instanceof Response) {
      if (!r.ok) return { ok: false, error: `zai tts HTTP ${r.status}` };
      bytes = new Uint8Array(await r.arrayBuffer());
    } else if (r instanceof ArrayBuffer) {
      bytes = new Uint8Array(r);
    } else {
      const rr = r as { audio?: string; base64?: string; data?: { base64?: string }[] };
      const b64 = rr.audio || rr.base64 || rr.data?.[0]?.base64;
      if (b64) bytes = Buffer.from(b64, "base64");
    }
    if (bytes?.length) return { ok: true, bytes, via: "zai-tts" };
    return { ok: false, error: "zai tts returned no audio" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** msedge-tts tier — keyless, no provider account, works on any host. */
async function synthViaEdge(text: string): Promise<SynthResult> {
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS({ enableLogger: false });
    await tts.setMetadata("en-US-AvaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text.slice(0, 4000));
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (c: Buffer) => chunks.push(c));
      audioStream.on("end", () => resolve());
      audioStream.on("error", reject);
      const t = setTimeout(() => reject(new Error("edge tts timeout")), 40_000);
      audioStream.on("end", () => clearTimeout(t));
    });
    const audio = Buffer.concat(chunks);
    if (!audio.length) return { ok: false, error: "edge tts returned no audio" };
    return { ok: true, bytes: new Uint8Array(audio), via: "edge-tts" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Synthesize speakable text to MP3 bytes: z-ai cloud tier first, keyless
 * edge tier second — so voice delivery survives dead cloud egress.
 */
export async function synthesizeVoice(speakText: string): Promise<SynthResult> {
  const text = speakText.trim();
  if (!text) return { ok: false, error: "no text to speak" };
  const zai = await synthViaZai(text);
  if (zai.ok) return zai;
  const edge = await synthViaEdge(text);
  if (edge.ok) return edge;
  return { ok: false, error: `${zai.error} | ${edge.error}` };
}
