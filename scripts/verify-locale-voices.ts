/* LIVE verification: every native voice in LOCALE_VOICES must synthesize
 * real audio against the Edge TTS service (the same tier voice-out uses).
 * Run: npx tsx scripts/verify-locale-voices.ts
 */
import { MsEdgeTTS, OUTPUT_FORMAT, type VoiceMetadata } from "msedge-tts";

const TABLE: Record<string, { f: string; m: string }> = {
  en: { f: "en-US-AvaNeural", m: "en-US-GuyNeural" },
  ru: { f: "ru-RU-SvetlanaNeural", m: "ru-RU-DmitryNeural" },
  he: { f: "he-IL-HilaNeural", m: "he-IL-AvriNeural" },
  uk: { f: "uk-UA-PolinaNeural", m: "uk-UA-OstapNeural" },
  es: { f: "es-ES-ElviraNeural", m: "es-ES-AlvaroNeural" },
  pt: { f: "pt-BR-FranciscaNeural", m: "pt-BR-AntonioNeural" },
  fr: { f: "fr-FR-DeniseNeural", m: "fr-FR-HenriNeural" },
  de: { f: "de-DE-KatjaNeural", m: "de-DE-ConradNeural" },
  it: { f: "it-IT-ElsaNeural", m: "it-IT-DiegoNeural" },
  tr: { f: "tr-TR-EmelNeural", m: "tr-TR-AhmetNeural" },
  ar: { f: "ar-SA-ZariyahNeural", m: "ar-SA-HamedNeural" },
  fa: { f: "fa-IR-DilaraNeural", m: "fa-IR-FaridNeural" },
  ka: { f: "ka-GE-EkaNeural", m: "ka-GE-GiorgiNeural" },
  pl: { f: "pl-PL-ZofiaNeural", m: "pl-PL-MarekNeural" },
  nl: { f: "nl-NL-ColetteNeural", m: "nl-NL-MaartenNeural" },
  zh: { f: "zh-CN-XiaoxiaoNeural", m: "zh-CN-YunxiNeural" },
  ja: { f: "ja-JP-NanamiNeural", m: "ja-JP-KeitaNeural" },
  ko: { f: "ko-KR-SunHiNeural", m: "ko-KR-InJoonNeural" },
  hi: { f: "hi-IN-SwaraNeural", m: "hi-IN-MadhurNeural" },
  th: { f: "th-TH-PremwadeeNeural", m: "th-TH-NiwatNeural" },
  vi: { f: "vi-VN-HoaiMyNeural", m: "vi-VN-NamMinhNeural" },
  id: { f: "id-ID-GadisNeural", m: "id-ID-ArifNeural" },
};

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

async function synth(voice: string): Promise<number> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream("Короткая проверка голоса. Short test.");
  const chunks: Buffer[] = [];
  for await (const c of audioStream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).length;
}

async function main() {
  for (const [lang, pair] of Object.entries(TABLE)) {
    for (const [g, voice] of Object.entries(pair) as [string, string][]) {
      try {
        const bytes = await synth(voice);
        check(`${lang}:${g} ${voice} → ${bytes} bytes`, bytes > 2000, `${bytes} bytes`);
      } catch (e) {
        check(`${lang}:${g} ${voice} → REAL AUDIO`, false, e instanceof Error ? e.message.slice(0, 120) : String(e));
      }
      await new Promise((r) => setTimeout(r, 250)); // be gentle with the service
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
