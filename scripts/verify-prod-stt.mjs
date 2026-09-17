// Prod verification: /api/voice/stt with a real Telegram-style OGG/Opus voice note
import { execSync } from "child_process";
import fs from "fs";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const BASE = process.argv[2] || "https://deep-init-ai.vercel.app";

const tts = new MsEdgeTTS();
await tts.setMetadata("en-US-AnaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
const r = await tts.toStream("What is the weather like in Tbilisi today?");
const chunks = [];
for await (const c of r.audioStream) chunks.push(c);
fs.writeFileSync("/tmp/prod-v.mp3", Buffer.concat(chunks));
execSync("ffmpeg -y -i /tmp/prod-v.mp3 -c:a libopus -b:a 24k -ar 16000 -ac 1 /tmp/prod-v.ogg", { stdio: "pipe" });
const ogg = fs.readFileSync("/tmp/prod-v.ogg");
console.log("voice note bytes:", ogg.length);

const res = await fetch(`${BASE}/api/voice/stt`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ audio: ogg.toString("base64"), mime: "audio/ogg", lang: "en-US" }),
});
console.log("status:", res.status);
const data = await res.json();
console.log("response:", JSON.stringify(data));
if (data.text && /weather|tbilisi/i.test(data.text)) {
  console.log("PROD STT: PASS ✅");
  process.exit(0);
}
console.log("PROD STT: FAIL ❌");
process.exit(1);
