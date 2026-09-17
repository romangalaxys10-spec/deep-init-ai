/* ============================================================
 * Server-side ASR — voice transcription that works EVERYWHERE.
 *
 * WHY: the z-ai SDK ASR endpoint (internal-api.z.ai) is only
 * reachable from the sandbox network — serverless deploys (Vercel)
 * can never reach it, which broke both Telegram voice notes and
 * the web voice-mode fallback. This module adds a keyless cloud
 * tier that runs from any host:
 *
 *   OGG/Opus (Telegram voice notes) → ogg-opus-decoder (WASM)
 *     → 48kHz float PCM → resample 16k mono → WAV
 *     → Google Web Speech API v2 (keyless, chromium public key)
 *
 *   WAV (web PCM capture) → decode → resample → Google v2
 *   MP3 / others → z-ai SDK ASR (where reachable)
 *
 * Zero API keys required on any deployment.
 * ============================================================ */

import { getZAI } from "./zai";

/* Chromium's public speech key — the same one embedded in every
 * Chrome install for Web Speech. Keyless from our side. */
const GOOGLE_STT_KEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw";
const GOOGLE_STT_URL = "https://www.google.com/speech-api/v2/recognize";
const GOOGLE_STT_TIMEOUT_MS = 20_000;

export interface AsrResult {
  text: string;
  via: string;
  error?: string;
}

/** Normalize loose language hints ("ru", "he-IL", "en_US") to STT locales. */
export function normLang(lang?: string | null): string {
  const l = (lang || "").trim().toLowerCase().replace("_", "-");
  if (!l) return "en-US";
  if (/^en/.test(l)) return "en-US";
  if (/^ru/.test(l)) return "ru-RU";
  if (/^(he|iw)/.test(l)) return "he-IL";
  if (/^uk/.test(l)) return "uk-UA";
  if (/^de/.test(l)) return "de-DE";
  if (/^fr/.test(l)) return "fr-FR";
  if (/^es/.test(l)) return "es-ES";
  if (/^pt/.test(l)) return "pt-BR";
  if (/^it/.test(l)) return "it-IT";
  if (/^ar/.test(l)) return "ar-SA";
  if (/^tr/.test(l)) return "tr-TR";
  if (/^ka/.test(l)) return "ka-GE";
  if (/^[a-z]{2}$/.test(l)) return `${l}-${l.toUpperCase()}`;
  if (/^[a-z]{2}-[a-z]{2,4}$/.test(l)) return l;
  return "en-US";
}

/** Encode float PCM samples as a 16-bit mono WAV buffer. */
export function encodeWavPcm16(samples: Float32Array, rate = 16000): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

/** Decode a RIFF/WAVE buffer (PCM 8/16/24/32-bit int, 32-bit float) to mono float samples. */
export function decodeWav(buf: Buffer): { samples: Float32Array; rate: number; channels: number } | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let off = 12;
  let rate = 16000;
  let bits = 16;
  let channels = 1;
  let fmt = 1;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt " && sz >= 16) {
      fmt = buf.readUInt16LE(off + 8);
      channels = Math.max(1, buf.readUInt16LE(off + 10));
      rate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = Math.min(sz, buf.length - off - 8);
      break;
    }
    off += 8 + sz + (sz % 2);
  }
  if (dataOff < 0 || dataLen <= 0) return null;
  const bytesPer = Math.max(1, bits >> 3);
  const frames = Math.floor(dataLen / (bytesPer * channels));
  if (frames <= 0) return null;
  const readSample = (o: number): number => {
    try {
      if (fmt === 3 && bits === 32) return buf.readFloatLE(o);
      if (bits === 16) return buf.readInt16LE(o) / 32768;
      if (bits === 8) return (buf.readUInt8(o) - 128) / 128;
      if (bits === 24) {
        let iv = (buf[o + 2] << 16) | (buf[o + 1] << 8) | buf[o];
        if (iv & 0x800000) iv -= 0x1000000;
        return iv / 8388608;
      }
      if (bits === 32) return buf.readInt32LE(o) / 2147483648;
    } catch {
      /* clipped frame — treat as silence */
    }
    return 0;
  };
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const base = dataOff + i * bytesPer * channels;
    if (channels === 1) {
      out[i] = readSample(base);
    } else {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += readSample(base + c * bytesPer);
      out[i] = sum / channels;
    }
  }
  return { samples: out, rate, channels };
}

/** Linear-interpolation resampler (speech-grade). */
export function resample(samples: Float32Array, srcRate: number, dstRate = 16000): Float32Array {
  if (!samples.length || srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const n = Math.max(0, Math.floor(samples.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Decode an Ogg Opus file (Telegram voice notes) to float PCM via WASM. */
export async function oggOpusDecode(bytes: Uint8Array): Promise<Float32Array | null> {
  try {
    const { OggOpusDecoder } = await import("ogg-opus-decoder");
    const dec = new OggOpusDecoder();
    await dec.ready;
    const out = await dec.decodeFile(new Uint8Array(bytes));
    await dec.free();
    const ch = out.channelData?.[0];
    if (!ch || !ch.length) return null;
    if (out.channelData.length > 1) {
      const ch1 = out.channelData[1];
      const mono = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) mono[i] = (ch[i] + (ch1[i] ?? 0)) / 2;
      return mono;
    }
    return ch;
  } catch {
    return null;
  }
}

/** Google Web Speech v2 — returns the best transcript or "" (none recognized). */
async function googleStt(wav: Buffer, lang: string): Promise<string> {
  const url = `${GOOGLE_STT_URL}?output=json&lang=${encodeURIComponent(lang)}&key=${GOOGLE_STT_KEY}&pfilter=2&maxresults=1`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GOOGLE_STT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "audio/l16; rate=16000" },
      body: new Uint8Array(wav),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`google stt HTTP ${res.status}`);
    const raw = await res.text();
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const j = JSON.parse(s) as {
          result?: { alternative?: { transcript?: string; confidence?: number }[] }[];
        };
        const alt = j.result?.[0]?.alternative?.[0];
        if (alt?.transcript) return cleanTranscript(alt.transcript);
      } catch {
        /* not JSON — skip line (endpoint emits one JSON per line) */
      }
    }
    return "";
  } finally {
    clearTimeout(t);
  }
}

/** z-ai SDK ASR — works only where the internal endpoint is reachable. */
async function zaiAsr(base64: string): Promise<string | null> {
  try {
    const zai = await getZAI();
    const r = (await zai.audio.asr.create({ file_base64: base64 })) as
      | { text?: string; result?: { text?: string } }
      | string;
    const text = typeof r === "string" ? r : r.text || r.result?.text || "";
    return cleanTranscript(text) || null;
  } catch {
    return null;
  }
}

/**
 * A transcript that contains no letters/digits in ANY script (e.g. "#",
 * "...", a bare symbol) is noise from a tone/silence — treat as no speech.
 */
function cleanTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  return t;
}

export const ASR_VIA_GOOGLE = "voice transcriber (google stt)";
export const ASR_VIA_ZAI = "voice transcriber (z-ai asr)";

/**
 * Transcribe raw audio bytes in any common container.
 * Returns { text } on success, { text: "", error } otherwise.
 */
export async function transcribeAudio(
  bytes: Buffer,
  mimeHint = "",
  langHint = "en"
): Promise<AsrResult> {
  const lang = normLang(langHint);
  if (!bytes?.length) return { text: "", via: "", error: "empty audio" };
  if (bytes.length > 9 * 1024 * 1024) {
    return { text: "", via: "", error: "audio too long — keep voice notes under a few minutes" };
  }

  const head4 = bytes.toString("ascii", 0, 4);
  const isOgg = head4 === "OggS" || /ogg/i.test(mimeHint);
  const isWav = head4 === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";

  if (isOgg) {
    const pcm = await oggOpusDecode(bytes);
    if (pcm && pcm.length) {
      const wav = encodeWavPcm16(resample(pcm, 48000), 16000);
      const text = await googleStt(wav, lang);
      if (text) return { text, via: ASR_VIA_GOOGLE };
    }
    const viaZai = await zaiAsr(bytes.toString("base64"));
    if (viaZai) return { text: viaZai, via: ASR_VIA_ZAI };
    return { text: "", via: "", error: pcm ? "no speech recognized" : "could not decode audio" };
  }

  if (isWav) {
    const dec = decodeWav(bytes);
    if (dec && dec.samples.length) {
      const wav = encodeWavPcm16(resample(dec.samples, dec.rate), 16000);
      const text = await googleStt(wav, lang);
      if (text) return { text, via: ASR_VIA_GOOGLE };
      const viaZai = await zaiAsr(bytes.toString("base64"));
      if (viaZai) return { text: viaZai, via: ASR_VIA_ZAI };
      return { text: "", via: "", error: "no speech recognized" };
    }
    const viaZai = await zaiAsr(bytes.toString("base64"));
    if (viaZai) return { text: viaZai, via: ASR_VIA_ZAI };
    return { text: "", via: "", error: "could not decode audio" };
  }

  /* MP3 / M4A / WebM etc — SDK ASR where reachable (audio notes). */
  const viaZai = await zaiAsr(bytes.toString("base64"));
  if (viaZai) return { text: viaZai, via: ASR_VIA_ZAI };
  return { text: "", via: "", error: "unsupported audio format — send a voice note (ogg/opus) or wav" };
}
