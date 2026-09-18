/* LIVE prod verification of the Language Mirror STT:
 * 1. synthesize Spanish speech → WAV (z-ai tts tier)
 * 2. POST it to PROD /api/voice/stt with multiLang=true → expect a Spanish
 *    transcript + lang:"es" (the recognizer tries locales until one understands)
 * 3. the same audio with multiLang=false (single en-US pass) — the old behavior
 *
 * Run: npx tsx scripts/verify-lang-mirror-live.ts
 */
import { getZAI } from "../src/lib/zai";

const BASE = process.env.BASE || "https://deep-init-ai.vercel.app";

async function synthWav(text: string): Promise<Buffer> {
  const zai = await getZAI();
  const r = (await (zai.audio.tts as unknown as {
    create: (o: Record<string, unknown>) => Promise<unknown>;
  }).create({ input: text, response_format: "wav" })) as unknown;
  if (r instanceof Response) return Buffer.from(await r.arrayBuffer());
  if (r instanceof ArrayBuffer) return Buffer.from(r);
  const any = r as { data?: string | ArrayBuffer; audio?: string };
  if (typeof any?.data === "string") return Buffer.from(any.data, "base64");
  if (any?.data instanceof ArrayBuffer) return Buffer.from(any.data);
  if (typeof any?.audio === "string") return Buffer.from(any.audio, "base64");
  throw new Error("unrecognized tts response shape");
}

async function main() {
  const spanish = "Hola, ¿cómo estás? El cielo es azul y el sol brilla hoy.";
  console.log("synthesizing Spanish WAV via z-ai tts…");
  const wav = await synthWav(spanish);
  console.log(`got ${wav.length} bytes, RIFF=${wav.toString("ascii", 0, 4)}`);

  const post = async (multiLang: boolean) => {
    const res = await fetch(`${BASE}/api/voice/stt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: wav.toString("base64"), mime: "audio/wav", lang: "en-US", multiLang }),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { text?: string; lang?: string; error?: string } };
  };

  const on = await post(true);
  console.log("multiLang=true →", on.status, JSON.stringify(on.body));
  const t = (on.body.text || "").toLowerCase();
  const spanishish = /hola|cielo|azul|sol|brilla|est[aá]/.test(t);
  const okOn = on.status === 200 && on.body.text && spanishish && on.body.lang === "es";

  const off = await post(false);
  console.log("multiLang=false →", off.status, JSON.stringify(off.body));

  let pass = 0, fail = 0;
  const check = (name: string, cond: boolean, extra = "") => {
    if (cond) { pass++; console.log(`  ok  ${name}`); }
    else { fail++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
  };
  check("multiLang ON: transcript recognized", Boolean(on.body.text), JSON.stringify(on.body));
  check("multiLang ON: Spanish words in transcript", spanishish, t.slice(0, 120));
  check("multiLang ON: lang tag = es", on.body.lang === "es", String(on.body.lang));
  check("multiLang OFF: single pass behaves like the old mode (may miss Spanish)", off.status === 200 || off.status === 422, `${off.status} ${JSON.stringify(off.body).slice(0, 120)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
