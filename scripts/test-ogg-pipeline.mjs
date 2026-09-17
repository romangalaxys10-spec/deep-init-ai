// Proof pipeline: ogg/opus (telegram voice format) → WASM decode → 16k WAV → google v2 STT
import { execSync } from "child_process";
import fs from "fs";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { OggOpusDecoder } from "ogg-opus-decoder";

const KEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw";

function encodeWavPcm16(samples, rate = 16000) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

function resample(samples, srcRate, dstRate = 16000) {
  if (srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio, i0 = Math.floor(p), frac = p - i0;
    const a = samples[i0] ?? 0, b = samples[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

async function main() {
  // 1) make a speech sample → ogg/opus (like a Telegram voice note)
  const tts = new MsEdgeTTS();
  await tts.setMetadata("en-US-AnaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const r = await tts.toStream("Remind me to call the dentist tomorrow at three pm.");
  const chunks = [];
  for await (const c of r.audioStream) chunks.push(c);
  fs.writeFileSync("/tmp/v.mp3", Buffer.concat(chunks));
  execSync("ffmpeg -y -i /tmp/v.mp3 -c:a libopus -b:a 24k -ar 16000 -ac 1 /tmp/v.ogg", { stdio: "pipe" });
  const ogg = new Uint8Array(fs.readFileSync("/tmp/v.ogg"));
  console.log("ogg bytes:", ogg.length);

  // 2) WASM decode ogg → 48k float32 mono
  const dec = new OggOpusDecoder();
  await dec.ready;
  const out = await dec.decodeFile(ogg);
  await dec.free();
  console.log("decoded:", out.samplesDecoded, "samples @", out.sampleRate, "Hz, ch:", out.channelData.length);

  // 3) resample → wav → google
  const mono = out.channelData[0];
  const wav = encodeWavPcm16(resample(mono, out.sampleRate), 16000);
  console.log("wav bytes:", wav.length);
  const url = `https://www.google.com/speech-api/v2/recognize?output=json&lang=en-US&key=${KEY}&pfilter=2&maxresults=1`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "audio/l16; rate=16000" }, body: wav });
  console.log("status:", res.status);
  const text = await res.text();
  console.log("body:", text.slice(0, 300));
}
main().catch((e) => { console.error("FATAL", e?.message || e); process.exit(1); });
