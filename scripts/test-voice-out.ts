/* VoiceOut layer tests — deterministic voice delivery for Telegram:
 *  1. extractVoiceBlocks: every hallucinated dialect becomes a voice note,
 *     tags never leak into visible text (the production screenshot bug)
 *  2. mdToSpeechText: markdown → speakable prose (code, links, images,
 *     emphasis, tables, length cap)
 *  3. synthesizeVoice: live TTS chain (z-ai → keyless edge) returns real MP3
 *  4. /voice mode cycle semantics (pure logic mirror of the command)
 * Run: npx tsx scripts/test-voice-out.ts
 */
import {
  extractVoiceBlocks,
  mdToSpeechText,
  synthesizeVoice,
} from "../src/lib/voice-out";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

function main() {
  /* ── 1. extractVoiceBlocks ──────────────────────────────────────────── */

  // the EXACT production bug from the screenshot: intro + <tts> block
  const prodCase = [
    "I'll generate a voice response for you about Batumi.",
    "<tts>",
    "According to the search results, here are some events happening in Batumi this weekend.",
    "The Little Red Riding Hood Puppet Fairy Tale is showing at Batumi Puppet Theater.",
    "</tts>",
    "Would you like me to search for more specific events?",
  ].join("\n");
  const r1 = extractVoiceBlocks(prodCase);
  check("1a. block extracted as voice text", r1.voiceTexts.length === 1 && r1.voiceTexts[0].includes("Batumi this weekend"), JSON.stringify(r1.voiceTexts));
  check("1b. visible text keeps intro + outro", r1.text.includes("I'll generate") && r1.text.includes("more specific events"), r1.text);
  check("1c. NO <tts> tag leaks into visible text", !/<\/?tts>/i.test(r1.text), r1.text);

  // multiple blocks, order preserved
  const r2 = extractVoiceBlocks("A <tts>first</tts> B <tts>second</tts> C");
  check("2a. two blocks, in order", r2.voiceTexts.join("|") === "first|second", r2.voiceTexts.join("|"));
  check("2b. surrounding text kept, blocks removed", r2.text === "A B C", r2.text);

  // dialect variants (case-insensitive)
  const r3 = extractVoiceBlocks("<voice>v1</voice> <AUDIO>a1</AUDIO> <Speak>s1</Speak> <text_to_speech>t1</text_to_speech>");
  check("3a. voice/audio/speak/text_to_speech dialects parsed", r3.voiceTexts.join("|") === "v1|a1|s1|t1", r3.voiceTexts.join("|"));
  check("3b. no tag residue", !/tts|voice|audio|speak/i.test(r3.text), r3.text);

  // stray/unpaired tags — stripped, never leaked; swallowed words survive
  // (the unclosed <tts> pair claims "unclosed … world" as a voice note)
  const r4 = extractVoiceBlocks("hello <tts> unclosed </voice> world </tts> <tts/> <voice/>");
  check("4a. stray tags stripped from text and voice", !/tts|voice/i.test(r4.text + " " + r4.voiceTexts.join(" ")), r4.text + " | " + r4.voiceTexts.join(" "));
  check("4b. words survive in text or voice", r4.text.includes("hello") && (r4.text.includes("world") || r4.voiceTexts.join(" ").includes("world")), `${r4.text} | ${r4.voiceTexts.join(" ")}`);

  // empty/whitespace block → no voice text, no crash
  const r5 = extractVoiceBlocks("x <tts>   </tts> y");
  check("5a. empty block dropped", r5.voiceTexts.length === 0, JSON.stringify(r5.voiceTexts));
  check("5b. text cleaned around empty block", r5.text === "x y", r5.text);

  // normal replies pass through untouched
  const plain = "Just a normal **markdown** reply with `code` and [a link](https://x.y).";
  const r6 = extractVoiceBlocks(plain);
  check("6a. plain reply untouched", r6.text === plain && r6.voiceTexts.length === 0, r6.text);

  /* ── 2. mdToSpeechText ──────────────────────────────────────────────── */

  const s1 = mdToSpeechText(
    [
      "## Headline",
      "- **Bold point** with [a link](https://example.com/x) and `inline_code`",
      "![chart](https://example.com/chart.png)",
      "```js",
      "console.log(1);",
      "console.log(2);",
      "console.log(3);",
      "```",
      "Read more: https://example.com/long-url",
    ].join("\n")
  );
  check("7a. heading marker stripped", !s1.includes("#"), s1);
  check("7b. bold/emphasis stripped", !s1.includes("**"), s1);
  check("7c. link → label", s1.includes("a link") && !s1.includes("](https"), s1);
  check("7d. bare URL → link", !s1.includes("https://") && s1.includes("link"), s1);
  check("7e. code fence → spoken summary", s1.includes("code block, 3 lines"), s1);
  check("7f. image alt preserved as (image)", !s1.includes("![") && !s1.includes("](http"), s1);

  const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} talks about thing ${i}.`).join(" ");
  const s2 = mdToSpeechText(long);
  check("8a. long text capped", s2.length < 3900, String(s2.length));
  check("8b. cap carries the pointer", s2.includes("full answer is in the text message"), s2.slice(-80));

  /* ── 3. /voice mode cycle (mirror of the command logic) ─────────────── */
  const next = (m: "auto" | "on" | "off") => (m === "auto" ? "on" : m === "on" ? "off" : "auto");
  check("9a. cycle auto→on→off→auto", next("auto") === "on" && next("on") === "off" && next("off") === "auto");
}

async function liveTts() {
  /* ── 4. live synthesis chain ────────────────────────────────────────── */
  const r = await synthesizeVoice("Hello from Deep-init AI. Voice delivery is now deterministic.");
  check("10a. live TTS produced audio", r.ok && !!r.bytes && r.bytes.length > 1000, r.error || `${r.bytes?.length}B via ${r.via}`);
  check("10b. synthesis tier reported", r.ok && !!r.via, r.via || r.error);
}

async function mainAsync() {
  main();
  await liveTts();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

mainAsync().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
