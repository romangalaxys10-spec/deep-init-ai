// Test keyless Google Web Speech API v2 (chromium public key) from a cloud IP
// 1) make speech sample via msedge-tts -> mp3 -> ffmpeg -> 16k mono wav
// 2) POST to google speech-api v2
import { execSync } from "child_process";
import fs from "fs";

const KEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw"; // chromium public key

async function main() {
  // 1. speech sample (en) via msedge-tts
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  await tts.setMetadata("en-US-AnaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const speech = "Hello, this is a voice transcription test. What is the weather like today?";
  const r = await tts.toStream(speech);
  const chunks = [];
  for await (const c of r.audioStream) chunks.push(c);
  const mp3 = Buffer.concat(chunks);
  fs.writeFileSync("/tmp/sample.mp3", mp3);
  console.log("mp3 bytes:", mp3.length);
  execSync("ffmpeg -y -i /tmp/sample.mp3 -ar 16000 -ac 1 -f wav /tmp/sample.wav", { stdio: "pipe" });
  const wav = fs.readFileSync("/tmp/sample.wav");
  console.log("wav bytes:", wav.length);

  // 2. google v2 recognize
  const lang = "en-US";
  const url = `https://www.google.com/speech-api/v2/recognize?output=json&lang=${lang}&key=${KEY}&pfilter=2&maxresults=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "audio/l16; rate=16000" },
    body: wav,
  });
  console.log("status:", res.status);
  const text = await res.text();
  console.log("body:", text.slice(0, 500));
}
main().catch((e) => {
  console.error("FATAL", e?.message || e);
  process.exit(1);
});
