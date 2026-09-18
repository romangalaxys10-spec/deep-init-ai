/* Language Mirror tests — "add voice recognition in multi-language so it
 * doesn't matter which language I record, it will understand and respond
 * to me in the same language using text and voice. And make this feature
 * an on/off toggle."
 *
 * Covers the full vertical:
 *  1. detectLang — script + stop-word detection across 15+ languages
 *  2. nextLocales / pickBestPass — the bounded multi-locale STT strategy
 *  3. languageDirective / appendDirective — the deterministic reply rule
 *  4. localeVoiceFor / personaVoicePlan — native voice per language
 *  5. /api/agent/config — langMirror passport (persist + echo + no clobber)
 *  6. registry — the toggle survives re-pairing
 *  7. Telegram /lang — picker markup, ✅ marks, owner gating, /help + /status
 *  8. chat route e2e — voiceLang tag reaches the brain as the directive
 *     (mock OpenAI-compatible provider captures the system prompt)
 *
 * Run: npx tsx scripts/test-lang-mirror.ts
 */
import http from "http";
import { rmSync } from "fs";
import { NextRequest } from "next/server";
import { POST as configPOST } from "../src/app/api/agent/config/route";
import { POST as chatPOST } from "../src/app/api/chat/route";
import { registerAgent, findAgentByOwner, bindChat } from "../src/lib/agent-registry";
import { detectLang, languageDirective, appendDirective, parseLangTag } from "../src/lib/lang-detect";
import { nextLocales, pickBestPass, STT_MAX_PASSES, type SttPass } from "../src/lib/asr";
import { localeVoiceFor, personaVoicePlan } from "../src/lib/voice-personas";
import { handleTelegramUpdate } from "../src/lib/telegram";

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

/* ---------------- stub the Telegram Bot API ---------------- */

interface TgCall {
  method: string;
  body: Record<string, unknown>;
}
const tgCalls: TgCall[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("api.telegram.org")) {
    const method = url.split("/bot")[1]?.split("/")[1] || "";
    let body: Record<string, unknown> = {};
    try {
      body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    } catch {
      body = {};
    }
    tgCalls.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

const callsOf = (method: string) => tgCalls.filter((c) => c.method === method);
const lastCall = (method: string) => callsOf(method).at(-1);

/** mock OpenAI-compatible brain that CAPTURES the request for assertions */
let lastBrainRequest: { system: string; user: string } | null = null;
function mockCapturingBrainServer(content: string): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url.startsWith("/v1/chat/completions") && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as {
            messages?: { role: string; content: string }[];
          };
          const sys = parsed.messages?.find((m) => m.role === "system")?.content ?? "";
          const usr = [...(parsed.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
          lastBrainRequest = { system: sys, user: usr };
        } catch {
          lastBrainRequest = null;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, base: `http://127.0.0.1:${addr.port}/v1` });
    });
  });
}

function req(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  try {
    rmSync(".gateway/registry.json", { force: true });
  } catch {
    /* nothing to clean */
  }

  /* ── 1. detectLang ──────────────────────────────────────────────────── */
  console.log("\n[1] detectLang — script + stop-word detection");
  check("1a. English", detectLang("What can you do for me today?") === "en");
  check("1b. Russian", detectLang("Привет, как дела? Что можешь для меня сделать?") === "ru");
  check("1c. Ukrainian (ї/є/і)", detectLang("Привіт, як справи? Що можешь зробити?") === "uk");
  check("1d. Hebrew", detectLang("שלום, מה אתה יכול לעשות בשבילי? תודה") === "he");
  check("1e. Spanish (stop words)", detectLang("Hola, ¿qué puedes hacer por mí? Gracias") === "es");
  check("1f. Portuguese (não/você)", detectLang("Olá, o que você pode fazer por mim? Não sei") === "pt");
  check("1g. French", detectLang("Bonjour, que peux-tu faire pour moi? Merci beaucoup") === "fr");
  check("1h. German", detectLang("Hallo, was kannst du für mich tun? Danke schön") === "de");
  check("1i. Italian", detectLang("Ciao, cosa puoi fare per me? Grazie mille") === "it");
  check("1j. Turkish", detectLang("Merhaba, benim için ne yapabilirsin? Teşekkürler") === "tr");
  check("1k. Arabic (script)", detectLang("مرحبا ماذا يمكنك أن تفعل من أجلي شكرا") === "ar");
  check("1l. Persian (گ letter)", detectLang("سلام چه کاری می‌توانی برای من انجام دهی") === "fa");
  check("1m. Chinese (han)", detectLang("你好，你能为我做什么？谢谢") === "zh");
  check("1n. Japanese (kana)", detectLang("こんにちは、何ができますか？ありがとうございます") === "ja");
  check("1o. Korean (hangul)", detectLang("안녕하세요, 저를 위해 무엇을 할 수 있나요?") === "ko");
  check("1p. Georgian (script)", detectLang("გამარჯობა, რას შეგიძლია ჩემთვის? მადლობა") === "ka");
  check("1q. mixed ru + brand → ru", detectLang("Привет, что нового в Skype сегодня?") === "ru");
  check("1r. empty → en", detectLang("") === "en");
  check("1s. parseLangTag accepts ru-RU / rejects xx", parseLangTag("ru-RU") === "ru" && parseLangTag("he") === "he" && parseLangTag("xx") === null);

  /* ── 2. multi-locale STT strategy ───────────────────────────────────── */
  console.log("\n[2] nextLocales / pickBestPass — bounded multi-locale STT");
  const off = nextLocales("ru", false);
  check("2a. mirror OFF → exactly one pass (the hint)", off.length === 1 && off[0] === "ru-RU", JSON.stringify(off));
  const on = nextLocales("en", true);
  check("2b. mirror ON → hint first, then priority queue", on[0] === "en-US" && on[1] === "ru-RU" && on[2] === "he-IL", JSON.stringify(on));
  check("2c. no duplicates + hard cap", new Set(on).size === on.length && on.length <= STT_MAX_PASSES && on.length === STT_MAX_PASSES, JSON.stringify(on));
  const onRu = nextLocales("ru-RU", true);
  check("2d. hint already in queue → no re-add", onRu.filter((l) => l === "ru-RU").length === 1, JSON.stringify(onRu));

  const passes: SttPass[] = [
    { locale: "en-US", text: "uh", confidence: 0.2 },
    { locale: "ru-RU", text: "привет как дела", confidence: 0.62 },
    { locale: "he-IL", text: "", confidence: 0 },
  ];
  check("2e. low-confidence first → best of the rest wins", pickBestPass(passes)?.locale === "ru-RU", JSON.stringify(pickBestPass(passes)));
  const confident: SttPass[] = [
    { locale: "ru-RU", text: "привет", confidence: 0.31 },
    { locale: "en-US", text: "hello there", confidence: 0.91 },
  ];
  check("2f. a confident pass wins even if not first", pickBestPass(confident)?.locale === "en-US");
  const empty: SttPass[] = [
    { locale: "en-US", text: "", confidence: 0 },
    { locale: "ru-RU", text: "", confidence: 0 },
  ];
  check("2g. all passes empty → null (no hallucinated transcript)", pickBestPass(empty) === null);
  const tie: SttPass[] = [
    { locale: "en-US", text: "maybe", confidence: 0.5 },
    { locale: "ru-RU", text: "может", confidence: 0.5 },
  ];
  check("2h. exact tie → the earlier pass (hint prior) wins", pickBestPass(tie)?.locale === "en-US");

  /* ── 3. directive ───────────────────────────────────────────────────── */
  console.log("\n[3] languageDirective / appendDirective");
  const d = languageDirective("ru");
  check("3a. directive names the language", d.includes("Russian"), d.slice(0, 80));
  check("3b. directive orders full-reply compliance", d.includes("ENTIRELY") && d.includes("voice playback"));
  check("3c. appendDirective ON + ru → appended", appendDirective("base prompt", "ru", true).startsWith("base prompt\n\n[language mirror]"));
  check("3d. appendDirective OFF → unchanged", appendDirective("base prompt", "ru", false) === "base prompt");
  check("3e. appendDirective unknown tag → unchanged", appendDirective("base prompt", "zz", true) === "base prompt");
  check("3f. appendDirective no tag → unchanged", appendDirective("base prompt", undefined, true) === "base prompt");
  check("3g. he directive names Hebrew", appendDirective("", "he-IL", true).includes("Hebrew"));

  /* ── 4. voice locale matching ───────────────────────────────────────── */
  console.log("\n[4] localeVoiceFor / personaVoicePlan — native voice per language");
  check("4a. Nova (f) speaks Spanish → Elvira", localeVoiceFor("en-US-AvaNeural", "Hola, ¿qué tal?") === "es-ES-ElviraNeural", localeVoiceFor("en-US-AvaNeural", "Hola qué tal?"));
  check("4b. Atlas (m) speaks Russian → Dmitry", localeVoiceFor("en-US-GuyNeural", "Привет, как дела?") === "ru-RU-DmitryNeural");
  check("4c. Michelle (f) speaks Hebrew → Hila", localeVoiceFor("en-US-MichelleNeural", "שלום, מה שלומך?") === "he-IL-HilaNeural");
  check("4d. no persona + German → Katja (locale default f)", localeVoiceFor(undefined, "Guten Tag, was kannst du?") === "de-DE-KatjaNeural");
  check("4e. Sonia (f) speaks French → Denise", localeVoiceFor("en-GB-SoniaNeural", "Bonjour, ça va?") === "fr-FR-DeniseNeural");
  const plan = personaVoicePlan("en-US-AvaNeural", "Привет");
  check("4f. persona stays pinned across locales", plan.personaPinned && plan.edgeVoice === "ru-RU-SvetlanaNeural", JSON.stringify(plan));
  check("4g. English persona + English text → native voice", personaVoicePlan("en-US-GuyNeural", "Hello there, general").edgeVoice === "en-US-GuyNeural");

  /* ── 5. config route — Language Mirror passport ─────────────────────── */
  console.log("\n[5] /api/agent/config — langMirror toggle");
  const OWNER = "owner-lang-mirror-test";
  registerAgent({
    key: "k-lang-mirror",
    botToken: "12345:LANGMIRROR",
    builtIn: false,
    agentName: "MirrorBot",
    ownerName: "Tester",
    ownerToken: OWNER,
    systemPrompt: "test prompt for the mirror",
    providers: [],
    allowDemoBrain: false,
    whitelist: [],
  });
  const c0 = await (await configPOST(req("/api/agent/config", { ownerToken: OWNER }))).json();
  check("5a. default echo = ON (undefined → true)", c0.ok && c0.langMirror === true, JSON.stringify(c0.langMirror));
  const c1 = await (await configPOST(req("/api/agent/config", { ownerToken: OWNER, langMirror: false }))).json();
  check("5b. explicit off persisted + echoed", c1.ok && c1.langMirror === false && findAgentByOwner(OWNER)?.langMirror === false);
  // a voice/persona push must NOT clobber the language toggle
  await configPOST(req("/api/agent/config", { ownerToken: OWNER, voiceId: "en-US-AvaNeural", voiceRate: 5 }));
  check("5c. voice persona push does not clobber the toggle", findAgentByOwner(OWNER)?.langMirror === false, String(findAgentByOwner(OWNER)?.langMirror));
  const c2 = await (await configPOST(req("/api/agent/config", { ownerToken: OWNER, langMirror: true }))).json();
  check("5d. explicit on persisted + echoed", c2.ok && c2.langMirror === true && findAgentByOwner(OWNER)?.langMirror === true);
  // non-boolean garbage never flips it
  await configPOST(req("/api/agent/config", { ownerToken: OWNER, langMirror: "yes" as unknown as boolean }));
  check("5e. non-boolean ignored", findAgentByOwner(OWNER)?.langMirror === true);

  /* ── 6. registry — toggle survives re-pairing ───────────────────────── */
  console.log("\n[6] registry preservation across re-pairing");
  registerAgent({
    key: "k-lang-mirror",
    botToken: "12345:LANGMIRROR",
    builtIn: false,
    agentName: "MirrorBot",
    ownerName: "Tester",
    ownerToken: OWNER,
    systemPrompt: "test prompt for the mirror",
    providers: [],
    allowDemoBrain: false,
    whitelist: [],
  });
  check("6a. re-pairing (no langMirror field) preserves the toggle", findAgentByOwner(OWNER)?.langMirror === true);
  await configPOST(req("/api/agent/config", { ownerToken: OWNER, langMirror: false }));
  registerAgent({
    key: "k-lang-mirror",
    botToken: "12345:LANGMIRROR",
    builtIn: false,
    agentName: "MirrorBot",
    ownerName: "Tester",
    ownerToken: OWNER,
    systemPrompt: "test prompt for the mirror",
    providers: [],
    allowDemoBrain: false,
    whitelist: [],
  });
  check("6b. re-pairing preserves an explicit OFF", findAgentByOwner(OWNER)?.langMirror === false);

  /* ── 7. Telegram /lang picker ───────────────────────────────────────── */
  console.log("\n[7] Telegram /lang command + callbacks");
  const agent = registerAgent({
    key: "tg:lang-mirror",
    botToken: "111111111:TEST_lang_mirror_token",
    builtIn: true,
    agentName: "Mirror",
    ownerName: "Tester",
    ownerToken: "DIP-LANG-TEST",
    systemPrompt: "test",
    providers: [],
    allowDemoBrain: false,
    whitelist: [],
  });
  const botToken = agent.botToken;
  bindChat(agent, 4242, { mode: "owner", userName: "Tester", token: "DIP-LANG-TEST" });
  bindChat(agent, 5151, { mode: "shared", userName: "Guest", token: "DIP-GUEST-TOK" });

  tgCalls.length = 0;
  const outCmd = await handleTelegramUpdate({ update_id: 1, message: { message_id: 10, chat: { id: 4242, type: "private" }, text: "/lang", date: 1 } }, botToken);
  check("7a. /lang handled as hint", outCmd.handled === "hint", JSON.stringify(outCmd));
  const pickerMsg = lastCall("sendMessage");
  check("7b. picker message sent", Boolean(pickerMsg) && String(pickerMsg!.body.text).includes("Language mirror"), pickerMsg?.body.text as string);
  const mk = pickerMsg!.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
  const flat = mk.inline_keyboard.flat();
  check("7c. two buttons: lm:on / lm:off", flat.length === 2 && flat[0].callback_data === "lm:on" && flat[1].callback_data === "lm:off", JSON.stringify(flat));
  check("7d. default state ON → ✅ on the On button", flat[0].text.includes("✅") && !flat[1].text.includes("✅"), JSON.stringify(flat));

  // direct arg: /lang off
  tgCalls.length = 0;
  const outOff = await handleTelegramUpdate({ update_id: 2, message: { message_id: 11, chat: { id: 4242, type: "private" }, text: "/lang off", date: 2 } }, botToken);
  check("7e. /lang off confirmed", outOff.handled === "hint" && String(lastCall("sendMessage")?.body.text || "").includes("OFF"));
  check("7f. toggle persisted to the registry", agent.langMirror === false);
  await handleTelegramUpdate({ update_id: 21, message: { message_id: 13, chat: { id: 4242, type: "private" }, text: "/status", date: 21 } }, botToken);
  check("7g. /status shows the off state", String(callsOf("sendMessage").map((c) => c.body.text)).includes("Language mirror: off"));

  // callback: guest tap → denial; owner tap on → persisted + re-render
  tgCalls.length = 0;
  await handleTelegramUpdate(
    { update_id: 3, callback_query: { id: "cb-guest", from: { id: 2 }, message: { message_id: 777, chat: { id: 5151 } }, data: "lm:on" } },
    botToken
  );
  const guestToast = callsOf("answerCallbackQuery").find((c) => c.body.callback_query_id === "cb-guest");
  check("7h. non-owner tap denied honestly", Boolean(guestToast) && String(guestToast!.body.text).includes("owner"), guestToast?.body.text as string);
  check("7i. guest tap did NOT change the toggle", agent.langMirror === false);

  tgCalls.length = 0;
  const outOn = await handleTelegramUpdate(
    { update_id: 4, callback_query: { id: "cb-owner", from: { id: 1 }, message: { message_id: 777, chat: { id: 4242 } }, data: "lm:on" } },
    botToken
  );
  check("7j. owner tap handled", outOn.handled === "hint");
  check("7k. toggle back ON in the registry", agent.langMirror === true);
  const ownerToast = callsOf("answerCallbackQuery").find((c) => c.body.callback_query_id === "cb-owner");
  check("7l. toast announces ON", Boolean(ownerToast) && String(ownerToast!.body.text).includes("ON"));
  const reRender = lastCall("editMessageText");
  const mk2 = reRender?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined;
  const flat2 = mk2?.inline_keyboard.flat() ?? [];
  check("7m. picker re-rendered with ✅ on On", flat2.some((b) => b.callback_data === "lm:on" && b.text.includes("✅")), JSON.stringify(flat2));

  // /help advertises /lang
  tgCalls.length = 0;
  await handleTelegramUpdate({ update_id: 5, message: { message_id: 12, chat: { id: 4242, type: "private" }, text: "/help", date: 3 } }, botToken);
  check("7n. /help advertises /lang", String(lastCall("sendMessage")?.body.text || "").includes("/lang"));

  /* ── 8. chat route e2e — voiceLang reaches the brain ────────────────── */
  console.log("\n[8] chat route — directive injection (mock brain captures the prompt)");
  const { server: brainServer, base } = await mockCapturingBrainServer("Ответ на русском");
  try {
    registerAgent({
      key: "k-chat-mirror",
      botToken: "12345:CHATMIRROR",
      builtIn: false,
      agentName: "ChatMirror",
      ownerName: "Tester",
      ownerToken: "DIP-CHAT-MIRROR",
      systemPrompt: "base system prompt",
      providers: [],
      allowDemoBrain: false,
      whitelist: [],
    });

    lastBrainRequest = null;
    const resRu = await chatPOST(
      req("/api/chat", {
        messages: [
          { role: "system", content: "base system prompt" },
          { role: "user", content: "[voice note from Tester] привет, как дела?" },
        ],
        providers: [{ id: "p1", label: "Mock", baseUrl: base, apiKey: "", model: "m", compat: "openai" as const }],
        voiceLang: "ru",
      })
    );
    const jRu = await resRu.json();
    check("8a. chat answered", jRu.ok !== false && Boolean(jRu.content), JSON.stringify(jRu).slice(0, 120));
    check("8b. brain received the base system prompt", lastBrainRequest !== null && lastBrainRequest.system.startsWith("base system prompt"));
    check("8c. brain received the RUSSIAN directive", lastBrainRequest !== null && lastBrainRequest.system.includes("Reply ENTIRELY in natural, native Russian"), lastBrainRequest?.system.slice(-160));
    check("8d. user message untouched", lastBrainRequest !== null && lastBrainRequest.user.includes("привет, как дела?"));

    lastBrainRequest = null;
    await chatPOST(
      req("/api/chat", {
        messages: [
          { role: "system", content: "base system prompt" },
          { role: "user", content: "hello there" },
        ],
        providers: [{ id: "p1", label: "Mock", baseUrl: base, apiKey: "", model: "m", compat: "openai" as const }],
      })
    );
    check("8e. no voiceLang → no directive", lastBrainRequest !== null && !lastBrainRequest.system.includes("language mirror"), lastBrainRequest?.system.slice(-80));

    lastBrainRequest = null;
    await chatPOST(
      req("/api/chat", {
        messages: [{ role: "user", content: "שלום" }],
        providers: [{ id: "p1", label: "Mock", baseUrl: base, apiKey: "", model: "m", compat: "openai" as const }],
        voiceLang: "he-IL",
      })
    );
    check("8f. no system message → directive becomes the system", lastBrainRequest !== null && lastBrainRequest.system.includes("native Hebrew"), lastBrainRequest?.system.slice(0, 120));

    lastBrainRequest = null;
    await chatPOST(
      req("/api/chat", {
        messages: [
          { role: "system", content: "base system prompt" },
          { role: "user", content: "hola" },
        ],
        providers: [{ id: "p1", label: "Mock", baseUrl: base, apiKey: "", model: "m", compat: "openai" as const }],
        voiceLang: "es",
      })
    );
    check("8g. es directive names Spanish", lastBrainRequest !== null && lastBrainRequest.system.includes("native Spanish"));
  } finally {
    brainServer.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
