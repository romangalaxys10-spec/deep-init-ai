/* ============================================================
 * tg-media — Telegram media transport (multipart uploads)
 *
 * Deliberately dependency-free (no imports from brain/tools/telegram)
 * so BOTH the gateway (telegram.ts) and the tool layer (tools.ts) can
 * deliver media DIRECTLY without import cycles:
 *
 *   tools.ts ──┐
 *              ├──> tg-media.ts  (leaf module)
 *   telegram.ts┘
 *
 * Why direct delivery: the old flow (tool → store file → return URL →
 * model repeats URL → gateway fetches URL) broke on serverless — the
 * local-write fallback produced paths like /public/generated/voice-x.wav
 * that are never servable, so the user got the PATH as text (and the
 * voice mirror read it aloud). Tools now push bytes straight to the
 * Bot API and only report a status line to the model.
 *
 * TELEGRAM_API_BASE overrides https://api.telegram.org — used by the
 * test-suite to run the full multipart pipeline against a local mock.
 * ============================================================ */

const TG_TIMEOUT_MS = 20_000;

export function telegramApiBase(): string {
  return (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
}

function tgUrl(token: string, method: string) {
  return `${telegramApiBase()}/bot${token}/${method}`;
}

/**
 * Multipart file upload to the Bot API. Returns the parsed response so
 * callers can distinguish "rejected payload" from "network down".
 */
export async function tgMultipartCall<T = unknown>(
  token: string,
  method: string,
  fileField: string,
  bytes: Uint8Array,
  filename: string,
  extra: Record<string, string>,
  timeoutMs = TG_TIMEOUT_MS
): Promise<{ ok: boolean; result?: T; description?: string }> {
  try {
    const form = new FormData();
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    form.append(
      fileField,
      new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }),
      filename
    );
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(tgUrl(token, method), {
        method: "POST",
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
      return (await res.json()) as { ok: boolean; result?: T; description?: string };
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------- audio containers ----------------
 * sendVoice officially wants OGG/Opus; Telegram server-transcodes MP3
 * reliably (shows the waveform bubble). WAV is NOT transcodable into a
 * voice note — it arrives as a broken 0:00 bubble (production bug), so
 * WAV must go through sendAudio (the audio-player message) instead. */

export type VoiceContainer = "mp3" | "wav" | "ogg" | "unknown";

/** Which Bot API methods to try, in order, for a given audio container. */
export function voiceSendPlan(container: VoiceContainer): ("sendVoice" | "sendAudio")[] {
  if (container === "wav") return ["sendAudio"];
  if (container === "ogg") return ["sendVoice", "sendAudio"];
  // mp3 + unknown: voice bubble first, audio player as the safety net
  return ["sendVoice", "sendAudio"];
}

/** Sniff a container from magic bytes (WAV = RIFF…WAVE; MP3 = ID3 or frame sync). */
export function sniffAudioContainer(bytes: Uint8Array): VoiceContainer {
  if (bytes.length < 12) return "unknown";
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...bytes.slice(start, start + len));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
  if (ascii(0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  if (ascii(0, 4) === "OggS") return "ogg";
  return "unknown";
}

/**
 * Deliver synthesized audio as a REAL Telegram message, container-aware:
 *  • mp3/ogg → voice note (waveform bubble), audio-player fallback
 *  • wav     → audio player directly (voice bubble would render broken)
 * Returns true only when one of the attempts is accepted by the Bot API.
 */
export async function deliverVoiceBytes(
  token: string,
  chatId: number,
  bytes: Uint8Array,
  container: VoiceContainer = "mp3",
  caption?: string
): Promise<boolean> {
  const plan = voiceSendPlan(container);
  for (const method of plan) {
    const filename = method === "sendVoice" ? "voice.ogg" : `voice.${container === "wav" ? "wav" : "mp3"}`;
    const r = await tgMultipartCall(token, method, method === "sendVoice" ? "voice" : "audio", bytes, filename, {
      chat_id: String(chatId),
      ...(caption ? { caption: caption.slice(0, 1000) } : {}),
    });
    if (r.ok) return true;
  }
  return false;
}

/** Upload audio BYTES as a voice note (the waveform bubble). */
export async function tgSendVoiceBytes(
  token: string,
  chatId: number,
  bytes: Uint8Array,
  caption?: string
): Promise<boolean> {
  const r = await tgMultipartCall(token, "sendVoice", "voice", bytes, "voice.ogg", {
    chat_id: String(chatId),
    ...(caption ? { caption: caption.slice(0, 1000) } : {}),
  });
  return r.ok;
}

/** Upload audio BYTES as an audio-player message (WAV-safe). */
export async function tgSendAudioBytes(
  token: string,
  chatId: number,
  bytes: Uint8Array,
  title?: string
): Promise<boolean> {
  const r = await tgMultipartCall(token, "sendAudio", "audio", bytes, "audio.mp3", {
    chat_id: String(chatId),
    ...(title ? { title: title.slice(0, 60) } : {}),
  });
  return r.ok;
}

/* ---------------- photos ---------------- */

/** Upload image BYTES as a photo message (no URL round-trip needed). */
export async function tgSendPhotoBytes(
  token: string,
  chatId: number,
  bytes: Uint8Array,
  caption?: string
): Promise<boolean> {
  const r = await tgMultipartCall(token, "sendPhoto", "photo", bytes, "image.png", {
    chat_id: String(chatId),
    ...(caption ? { caption: caption.slice(0, 1000) } : {}),
  });
  return r.ok;
}
