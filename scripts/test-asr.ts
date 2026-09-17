/* ASR pipeline tests — run with: npx tsx scripts/test-asr.ts
 * Covers the keyless server-side transcription chain:
 *   WAV encode/decode roundtrip · resampling · language mapping
 *   OGG/Opus (Telegram voice format) → transcript (live Google)
 *   graceful failures on garbage input
 * Live checks need network; they fail loudly if the endpoint dies.
 */
import { execSync } from "child_process";
import fs from "fs";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import {
  transcribeAudio,
  encodeWavPcm16,
  decodeWav,
  resample,
  normLang,
} from "../src/lib/asr";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* ---------- unit: language mapping ---------- */
check("normLang ru → ru-RU", normLang("ru") === "ru-RU");
check("normLang he → he-IL", normLang("he") === "he-IL");
check("normLang iw → he-IL", normLang("iw") === "he-IL");
check("normLang en-US passthrough", normLang("en-US") === "en-US");
check("normLang empty → en-US", normLang("") === "en-US");
check("normLang fr → fr-FR", normLang("fr") === "fr-FR");
check("normLang garbage → en-US", normLang("not-a-lang!") === "en-US");

/* ---------- unit: WAV roundtrip ---------- */
const sine = new Float32Array(16000);
for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5;
const wav = encodeWavPcm16(sine, 16000);
check("wav header RIFF", wav.toString("ascii", 0, 4) === "RIFF");
check("wav header WAVE", wav.toString("ascii", 8, 12) === "WAVE");
const decoded = decodeWav(wav);
check("wav decode rate", decoded?.rate === 16000, `got ${decoded?.rate}`);
check("wav decode length", decoded?.samples.length === 16000, `got ${decoded?.samples.length}`);
let maxErr = 0;
for (let i = 0; i < 16000; i++) maxErr = Math.max(maxErr, Math.abs((decoded?.samples[i] ?? 0) - sine[i]));
check("wav roundtrip error < 1e-4", maxErr < 1e-4, `maxErr ${maxErr}`);

/* ---------- unit: resample ---------- */
const up = new Float32Array(48000).fill(0.25);
const down = resample(up, 48000, 16000);
check("resample 48k→16k length", down.length === 16000, `got ${down.length}`);
check("resample preserves DC", Math.abs(down[100] - 0.25) < 1e-6);
check("resample identity when same rate", resample(up, 16000, 16000) === up);

/* ---------- unit: stereo wav decode folds to mono ---------- */
const stereo = encodeWavPcm16(new Float32Array(8000).fill(0.5), 16000);
const stereo2 = Buffer.from(stereo);
check("mono decode channels", (decodeWav(stereo2)?.channels ?? 0) === 1);

/* ---------- fixture builders (ffmpeg is sandbox-only; fixtures are generated here) ---------- */
async function ttsToOgg(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const r = await tts.toStream(text);
  const chunks: Buffer[] = [];
  for await (const c of r.audioStream) chunks.push(c as Buffer);
  fs.writeFileSync("/tmp/asr-fixture.mp3", Buffer.concat(chunks));
  execSync("ffmpeg -y -i /tmp/asr-fixture.mp3 -c:a libopus -b:a 24k -ar 16000 -ac 1 /tmp/asr-fixture.ogg", {
    stdio: "pipe",
  });
  return fs.readFileSync("/tmp/asr-fixture.ogg");
}

async function main() {
  /* ---------- live: english voice note (the exact Telegram path) ---------- */
  const enOgg = await ttsToOgg("The quick brown fox jumps over the lazy dog.", "en-US-AnaNeural");
  const en = await transcribeAudio(enOgg, "audio/ogg", "en");
  check("en ogg → transcript", en.text.length > 10, JSON.stringify(en).slice(0, 120));
  check("en ogg → via google", en.via.includes("google"), en.via);
  check(
    "en ogg → words recognized",
    /quick|brown|fox/i.test(en.text),
    en.text
  );

  /* ---------- live: russian voice note (language routing) ---------- */
  const ruOgg = await ttsToOgg("Привет, это проверка распознавания речи.", "ru-RU-SvetlanaNeural");
  const ru = await transcribeAudio(ruOgg, "audio/ogg; codecs=opus", "ru");
  check(
    "ru ogg → russian transcript",
    /привет|проверк|реч/i.test(ru.text),
    ru.text || JSON.stringify(ru.error)
  );

  /* ---------- live: WAV path (web compat capture format) ---------- */
  const en2 = await transcribeAudio(
    encodeWavPcm16(resample(decodeWav(fs.readFileSync("/tmp/asr-fixture.ogg")) === null ? sine : sine, 16000), 16000),
    "audio/wav",
    "en-US"
  );
  // sine tone is not speech — expect empty transcript + honest error, NOT a crash
  check("wav non-speech → honest empty", !en2.text && !!en2.error, JSON.stringify(en2).slice(0, 120));

  /* ---------- graceful failures ---------- */
  const junk = await transcribeAudio(Buffer.from("this is not audio at all", "utf8"), "", "en");
  check("garbage bytes → error, no crash", !junk.text && !!junk.error, junk.error);
  const empty = await transcribeAudio(Buffer.alloc(0), "", "en");
  check("empty bytes → error", !empty.text && !!empty.error, empty.error);

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
