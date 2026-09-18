/* VoiceOut v2 tests — the deterministic direct-delivery voice architecture.
 * Reproduces the production bugs and proves the fixes:
 *   A1. extractMediaLinks: relative-path "voice note:" lines and relative
 *       markdown images NEVER reach the chat (the exact screenshot bug:
 *       "🎙 voice note: /public/generated/voice-1789705515502.wav")
 *   A2. mdToSpeechText: internal paths are never speakable (no "reading
 *       the path aloud")
 *   A3. container routing: WAV never goes through sendVoice (the broken
 *       0:00 bubble), MP3 does with an audio-player fallback
 *   A4. sniffAudioContainer magic bytes
 *   A5. voice-ledger: a tool-delivered voice note suppresses the mirror
 *       exactly once (no double-speak, no stuck suppression)
 *   A6. deliverVoiceBytes + tgSendPhotoBytes against a MOCK Bot API
 *   A7. runTts end-to-end: gateway ctx → direct delivery, result text has
 *       NO path/URL; no ctx + no blob → honest error, still NO path
 * Run: npx tsx scripts/test-voice-out-v2.ts
 */
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { extractMediaLinks } from "../src/lib/telegram";
import { mdToSpeechText, synthesizeVoice } from "../src/lib/voice-out";
import {
  deliverVoiceBytes,
  sniffAudioContainer,
  tgSendPhotoBytes,
  voiceSendPlan,
} from "../src/lib/tg-media";
import {
  consumeVoiceDelivered,
  noteVoiceDelivered,
  resetVoiceLedger,
} from "../src/lib/voice-ledger";
import { executeToolCall } from "../src/lib/tools";
import { registerAgent, getAgent } from "../src/lib/agent-registry";

let pass = 0;
let fail = 0;
let skipped = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const skip = (name: string, why: string) => {
  skipped++;
  console.log(`SKIP  ${name} — ${why}`);
};

/* ---------------- mock Bot API ---------------- */
interface Capture {
  method: string;
  fields: Record<string, string>;
  fileField?: string;
  filename?: string;
  bytesLen: number;
}
const captured: Capture[] = [];
let failSendVoiceOnce = false;

const mock = http.createServer((req, res) => {
  const url = req.url || "";
  const method = url.split("/").pop() || "";
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const text = body.toString("latin1");
      const fields: Record<string, string> = {};
      const fileField = /name="(voice|audio|photo|document)"/.exec(text)?.[1];
      // crude multipart parse — enough for assertions
      for (const m of text.matchAll(/name="([\w_]+)"\r\n\r\n([^\r\n]*)\r\n/g)) {
        if (m[1] !== fileField) fields[m[1]] = m[2];
      }
      const filename = /filename="([^"]+)"/.exec(text)?.[1];
      const isRejected = method === "sendVoice" && failSendVoiceOnce;
      captured.push({ method, fields, fileField, filename, bytesLen: body.length });
      if (isRejected) {
        failSendVoiceOnce = false;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, description: "voice payload rejected (test)" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  // JSON calls (sendMessage etc.) — acknowledge blindly
  captured.push({ method, fields: {}, bytesLen: 0 });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

/* tiny but real audio buffers */
function wavBytes(): Uint8Array {
  // RIFF header + minimal PCM payload
  const head = Buffer.from("RIFF____WAVEfmt ", "latin1");
  const rest = Buffer.alloc(64);
  return new Uint8Array(Buffer.concat([head, rest]));
}
function mp3Bytes(): Uint8Array {
  return new Uint8Array(Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.alloc(64)]));
}

async function main() {
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const port = (mock.address() as AddressInfo).port;
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;

  const TOKEN = "12345:TESTTOKEN";
  const CHAT = 4242;

  /* ── A1. extractMediaLinks hardening (the exact screenshot bug) ────── */
  console.log("\nA1. extractMediaLinks — relative-path leak removal");
  const prod = "Done!\n\n🎙 voice note: /public/generated/voice-1789705515502.wav\nEnjoy.";
  const r1 = extractMediaLinks(prod);
  check("A1a. relative voice-note line removed", !r1.text.includes("/public/generated"), JSON.stringify(r1.text));
  check("A1b. no 'voice note:' residue", !/voice note/i.test(r1.text), JSON.stringify(r1.text));
  check("A1c. surrounding prose kept", r1.text.includes("Done!") && r1.text.includes("Enjoy."), r1.text);
  check("A1d. no audio ref extracted from relative path", r1.audios.length === 0, JSON.stringify(r1.audios));

  const img = "Here you go:\n![generated image](/public/generated/img-123.png)\nNice.";
  const r2 = extractMediaLinks(img);
  check("A1e. relative-path image stripped", !r2.text.includes("/public/generated") && r2.photos.length === 0, JSON.stringify(r2.text));

  const httpsCase = "🎙 voice note: https://blob.vercel-storage.com/media/voice-1.mp3 and ![pic](https://x.example/i.png)";
  const r3 = extractMediaLinks(httpsCase);
  check("A1f. absolute voice URL still becomes media", r3.audios.length === 1 && r3.photos.length === 1, JSON.stringify({ a: r3.audios, p: r3.photos }));
  check("A1g. absolute URLs removed from text", !r3.text.includes("https://"), JSON.stringify(r3.text));

  const stray = "The file is at /public/generated/voice-99.wav if you need it.";
  const r4 = extractMediaLinks(stray);
  check("A1h. stray internal path scrubbed", !r4.text.includes("/public/generated"), JSON.stringify(r4.text));

  /* ── A2. mdToSpeechText — never speak internal paths ──────────────── */
  console.log("\nA2. mdToSpeechText — path stripping");
  const spoken = mdToSpeechText("Here is your answer.\n\n🎙 voice note: /public/generated/voice-1789705515502.wav\n\nAnd the details: **42**");
  check("A2a. path not spoken", !spoken.includes("/public/generated"), spoken);
  check("A2b. no 'voice note:' spoken", !/voice note/i.test(spoken), spoken);
  check("A2c. real content still spoken", spoken.includes("Here is your answer") && spoken.includes("42"), spoken);

  /* ── A3. container routing ─────────────────────────────────────────── */
  console.log("\nA3. voiceSendPlan — WAV never sent as a voice note");
  check("A3a. mp3 → sendVoice then sendAudio", JSON.stringify(voiceSendPlan("mp3")) === '["sendVoice","sendAudio"]', JSON.stringify(voiceSendPlan("mp3")));
  check("A3b. wav → sendAudio ONLY", JSON.stringify(voiceSendPlan("wav")) === '["sendAudio"]', JSON.stringify(voiceSendPlan("wav")));
  check("A3c. ogg → sendVoice then sendAudio", JSON.stringify(voiceSendPlan("ogg")) === '["sendVoice","sendAudio"]', JSON.stringify(voiceSendPlan("ogg")));

  /* ── A4. container sniffing ────────────────────────────────────────── */
  console.log("\nA4. sniffAudioContainer — magic bytes");
  check("A4a. RIFF/WAVE → wav", sniffAudioContainer(wavBytes()) === "wav");
  check("A4b. ID3 → mp3", sniffAudioContainer(mp3Bytes()) === "mp3");
  check("A4c. OggS → ogg", sniffAudioContainer(new Uint8Array(Buffer.from("OggS" + "0".repeat(20), "latin1"))) === "ogg");
  check("A4d. junk → unknown", sniffAudioContainer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) === "unknown");

  /* ── A5. voice ledger ──────────────────────────────────────────────── */
  console.log("\nA5. voice-ledger — no double-speak");
  resetVoiceLedger();
  check("A5a. empty ledger → no note", consumeVoiceDelivered("a:1") === false);
  noteVoiceDelivered("a:1");
  check("A5b. note consumed once", consumeVoiceDelivered("a:1") === true);
  check("A5c. second consume → false (mirror can speak next turn)", consumeVoiceDelivered("a:1") === false);

  /* ── A6. delivery against the mock Bot API ─────────────────────────── */
  console.log("\nA6. deliverVoiceBytes / tgSendPhotoBytes vs mock Bot API");
  captured.length = 0;
  const sentMp3 = await deliverVoiceBytes(TOKEN, CHAT, mp3Bytes(), "mp3");
  check("A6a. mp3 delivered via sendVoice", sentMp3 && captured.at(-1)?.method === "sendVoice", JSON.stringify(captured.at(-1)));
  check("A6b. chat_id field set", captured.at(-1)?.fields.chat_id === String(CHAT));

  captured.length = 0;
  const sentWav = await deliverVoiceBytes(TOKEN, CHAT, wavBytes(), "wav");
  check("A6c. wav routed to sendAudio (NOT sendVoice)", sentWav && captured.at(-1)?.method === "sendAudio" && !captured.some((c) => c.method === "sendVoice"), JSON.stringify(captured.map((c) => c.method)));

  captured.length = 0;
  failSendVoiceOnce = true;
  const sentFallback = await deliverVoiceBytes(TOKEN, CHAT, mp3Bytes(), "mp3");
  check("A6d. sendVoice refusal → sendAudio fallback", sentFallback && captured.map((c) => c.method).join(",") === "sendVoice,sendAudio", JSON.stringify(captured.map((c) => c.method)));

  captured.length = 0;
  const photoSent = await tgSendPhotoBytes(TOKEN, CHAT, new Uint8Array(Buffer.alloc(32)), "a cat");
  check("A6e. photo bytes → sendPhoto with caption", photoSent && captured.at(-1)?.method === "sendPhoto" && captured.at(-1)?.fields.caption === "a cat", JSON.stringify(captured.at(-1)));

  /* ── A7. runTts end-to-end ─────────────────────────────────────────── */
  console.log("\nA7. runTts — direct delivery, no paths anywhere");
  registerAgent({
    key: "k-test",
    botToken: TOKEN,
    builtIn: false,
    agentName: "TestBot",
    ownerName: "Tester",
    ownerToken: "owner-k-test",
    systemPrompt: "test",
    providers: [],
    allowDemoBrain: true,
    whitelist: [],
    voiceId: "en-US-AvaNeural",
  });
  const agent = getAgent("k-test");
  check("A7a. test agent registered", Boolean(agent));

  // live synthesis first — skip the live part cleanly if the network is blocked
  captured.length = 0;
  resetVoiceLedger();
  const live = await synthesizeVoice("Voice out v2 direct delivery test.", { voiceId: "en-US-AvaNeural" });
  if (!live.ok || !live.bytes?.length) {
    skip("A7b. live TTS synthesis", `no egress in sandbox (${(live.error || "").slice(0, 80)})`);
  } else {
    check("A7b. live synth returns bytes + container", live.bytes.length > 1000 && Boolean(live.container), `container=${live.container} bytes=${live.bytes.length}`);
    const r = await executeToolCall(
      { name: "tts", params: { text: "Voice out v2 direct delivery test." } },
      { agentKey: "k-test", chatId: CHAT, voiceId: "en-US-AvaNeural" }
    );
    check("A7c. tool reports delivered, NOT a link", r.startsWith("tts ok") && !r.includes("voice note:") && !r.includes("/public/generated"), r.slice(0, 140));
    check("A7d. audio hit the mock Bot API", captured.some((c) => c.method === "sendVoice" || c.method === "sendAudio"), JSON.stringify(captured.map((c) => c.method)));
    check("A7e. ledger noted (mirror will stay silent)", consumeVoiceDelivered(`k-test:${CHAT}`) === true);
    check("A7f. persona pinned to Edge (Ava, not the z-ai default)", !live.via?.startsWith("zai-tts"), `via=${live.via}`);
  }

  // no ctx + no blob token → honest storage error, still no path
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const noCtx = await executeToolCall({ name: "tts", params: { text: "hello there" } }, undefined);
  check("A7g. no-ctx failure is pathless & honest", noCtx.includes("tts ok, but audio storage is unavailable") && !noCtx.includes("/public/") && !noCtx.includes("voice note:"), noCtx.slice(0, 160));

  // production simulation: no blob token + NODE_ENV=production → the
  // dev-only public/ write is skipped → honest error, never a fake path
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const imgNoCtx = await executeToolCall(
    { name: "image_gen", params: { prompt: "test" } },
    undefined
  ).catch((e) => `threw: ${e}`);
  process.env.NODE_ENV = prevNodeEnv;
  check("A7h. image_gen without storage/delivery never leaks a path", String(imgNoCtx).includes("could not be delivered") && !String(imgNoCtx).includes("/public/generated"), String(imgNoCtx).slice(0, 140));

  console.log(`\n════════ voice-out v2: ${pass} passed · ${fail} failed · ${skipped} skipped ════════`);
  mock.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("fatal:", e);
  mock.close();
  process.exit(1);
});
