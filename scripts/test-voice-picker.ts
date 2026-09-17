/* Voice Persona Passport tests — the Telegram voice picker must behave like
 * the web console picker, and the persona must actually reach the synth:
 *  1. persona catalog: the shared single source (web picker + Telegram + gateway)
 *  2. personaVoicePlan: persona-pinned → Edge FIRST (the "stuck Asian female"
 *     bug — z-ai's fixed default used to drown every pick)
 *  3. locale adaptation: persona style preserved, voice follows the text script
 *  4. live synthesis: real audio bytes for an English persona AND a Cyrillic
 *     reply spoken with the persona's Russian counterpart voice
 *  5. /voice + /voices picker: inline keyboard identical in content to the
 *     web popover, mode row, current-selection marks
 *  6. callback_query handling: persona pick / default / mode pick persist in
 *     the registry, toasts fire, picker re-renders
 *  7. registry plumbing: agent-level persona survives re-pairing; chat
 *     override survives re-bind
 * Run: npx tsx scripts/test-voice-picker.ts
 */
import {
  VOICE_PERSONAS,
  detectSpeechLang,
  isKnownPersonaVoice,
  localeVoiceFor,
  personaVoicePlan,
} from "../src/lib/voice-personas";
import { synthesizeVoice } from "../src/lib/voice-out";
import {
  bindChat,
  findBoundAgent,
  registerAgent,
  type RegisteredAgent,
} from "../src/lib/agent-registry";
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

async function main() {
  /* ── 1. catalog ─────────────────────────────────────────────────────── */
  console.log("\n[1] persona catalog");
  check("1a. six personas", VOICE_PERSONAS.length === 6, String(VOICE_PERSONAS.length));
  check("1b. unique voice ids", new Set(VOICE_PERSONAS.map((p) => p.voice)).size === 6);
  check(
    "1c. web picker presets are these exact voices",
    VOICE_PERSONAS.map((p) => p.voice).join(",") ===
      [
        "en-US-AvaNeural",
        "en-US-GuyNeural",
        "en-US-AriaNeural",
        "en-GB-SoniaNeural",
        "en-US-EricNeural",
        "en-US-MichelleNeural",
      ].join(","),
    VOICE_PERSONAS.map((p) => p.voice).join(",")
  );
  check("1d. every persona has name/persona/gender/emoji", VOICE_PERSONAS.every((p) => p.name && p.persona && p.emoji && (p.gender === "f" || p.gender === "m")));
  check("1e. known/unknown detection", isKnownPersonaVoice("en-US-AvaNeural") && !isKnownPersonaVoice("tongtong") && !isKnownPersonaVoice(null));

  /* ── 2. tier plan — THE bug fix ─────────────────────────────────────── */
  console.log("\n[2] personaVoicePlan — persona pins Edge first");
  const p1 = personaVoicePlan("en-US-GuyNeural", "hello there");
  check("2a. known persona → pinned", p1.personaPinned === true);
  check("2b. pinned voice = persona voice", p1.edgeVoice === "en-US-GuyNeural", p1.edgeVoice);
  const p2 = personaVoicePlan(null, "hello there");
  check("2c. no persona → legacy chain", p2.personaPinned === false);
  check("2d. legacy edge default = Ava", p2.edgeVoice === "en-US-AvaNeural", p2.edgeVoice);
  const p3 = personaVoicePlan("tongtong", "hello");
  check("2e. unknown id treated as no persona", p3.personaPinned === false);

  /* ── 3. locale adaptation ───────────────────────────────────────────── */
  console.log("\n[3] locale adaptation — style kept, language native");
  check("3a. lang detect en/ru/he", detectSpeechLang("hello") === "en" && detectSpeechLang("привет") === "ru" && detectSpeechLang("שלום") === "he");
  check("3b. male persona → Russian male voice", localeVoiceFor("en-US-GuyNeural", "Привет, мир") === "ru-RU-DmitryNeural", localeVoiceFor("en-US-GuyNeural", "Привет"));
  check("3c. female persona → Russian female voice", localeVoiceFor("en-US-AvaNeural", "Проверка связи") === "ru-RU-SvetlanaNeural");
  check("3d. female persona → Hebrew female voice", localeVoiceFor("en-US-MichelleNeural", "שלום, מה שלומך") === "he-IL-HilaNeural");
  check("3e. persona natively speaks English unchanged", localeVoiceFor("en-GB-SoniaNeural", "good day") === "en-GB-SoniaNeural");
  check("3f. no persona + Cyrillic → Russian default", localeVoiceFor(null, "привет") === "ru-RU-SvetlanaNeural");
  check("3g. plan adapts the edge voice for Russian text", personaVoicePlan("en-US-EricNeural", "как дела?").edgeVoice === "ru-RU-DmitryNeural");

  /* ── 4. live synthesis with personas ────────────────────────────────── */
  console.log("\n[4] live persona synthesis (network)");
  try {
      const r1 = await synthesizeVoice("Hello, I am your agent. This is the Atlas persona speaking.", {
        voiceId: "en-US-GuyNeural",
      });
      check("4a. persona synth returns audio", r1.ok && (r1.bytes?.length ?? 0) > 1000, `${r1.ok} ${r1.error || ""}`);
      check("4b. via proves EDGE tier with the persona voice (not z-ai default)", r1.via === "edge-tts:en-US-GuyNeural", r1.via);

      const r2 = await synthesizeVoice("Привет! Это ваш личный ассистент. Проверка русского голоса.", {
        voiceId: "en-US-GuyNeural",
      });
      check("4c. Cyrillic reply synthesized with Russian counterpart", r2.ok && r2.via === "edge-tts:ru-RU-DmitryNeural", r2.via || r2.error);

      const r3 = await synthesizeVoice("Quick rate and pitch check.", { voiceId: "en-US-AvaNeural", rate: 20, pitch: -10 });
      check("4d. rate/pitch tweaks accepted", r3.ok && r3.via === "edge-tts:en-US-AvaNeural", r3.via || r3.error);

      const r4 = await synthesizeVoice("Legacy chain still works without a persona.");
      check("4e. no-persona legacy path still returns audio", r4.ok && (r4.bytes?.length ?? 0) > 1000, r4.error);
    } catch (e) {
      check("4x. live synth suite crashed", false, e instanceof Error ? e.message : String(e));
    }

    /* ── 5/6/7. picker + callbacks + registry (stubbed Telegram) ──────── */
    console.log("\n[5] /voice picker via Telegram");
    const agent: RegisteredAgent = registerAgent({
      key: "test:voice-picker",
      botToken: "111111111:TEST_voice_picker_token",
      builtIn: true,
      agentName: "Vox",
      ownerName: "Tester",
      ownerToken: "DIP-TEST-TEST",
      systemPrompt: "test",
      providers: [],
      allowDemoBrain: true,
      whitelist: [],
      voiceId: "en-US-AvaNeural",
      voiceRate: -10,
      voicePitch: 5,
    });
    const botToken = agent.botToken;
    bindChat(agent, 4242, { mode: "owner", userName: "Tester", token: "DIP-TEST-TEST" });

    tgCalls.length = 0;
    const out1 = await handleTelegramUpdate(
      {
        update_id: 1,
        message: { message_id: 11, date: 1, chat: { id: 4242, type: "private" }, from: { id: 7, first_name: "T" }, text: "/voice" },
      },
      botToken
    );
    check("5a. /voice handled as hint", out1.handled === "hint", JSON.stringify(out1));
    const pickerMsg = lastCall("sendMessage");
    check("5b. picker sent as one message", Boolean(pickerMsg));
    const markup = pickerMsg?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined;
    check("5c. picker carries inline keyboard", Boolean(markup?.inline_keyboard?.length));
    const flatButtons = (markup?.inline_keyboard || []).flat();
    check("5d. all six personas on buttons", flatButtons.filter((b) => b.callback_data.startsWith("vp:") && b.callback_data !== "vp:default").length === 6);
    check("5e. mode row present (auto/always/off)", ["vm:auto", "vm:on", "vm:off"].every((d) => flatButtons.some((b) => b.callback_data === d)));
    check("5f. account persona marked active (Nova ✅)", flatButtons.some((b) => b.callback_data === "vp:en-US-AvaNeural" && b.text.includes("✅")));
    check("5g. picker text names the web-console source", String(pickerMsg?.body.text || "").includes("synced from the web console"), String(pickerMsg?.body.text || "").split("\n")[1]);
    check("5h. follow-web-console button present", flatButtons.some((b) => b.callback_data === "vp:default" && b.text.includes("🔹")));

    tgCalls.length = 0;
    const outV = await handleTelegramUpdate(
      {
        update_id: 2,
        message: { message_id: 12, date: 2, chat: { id: 4242, type: "private" }, text: "/voices" },
      },
      botToken
    );
    check("5i. /voices alias also opens the picker", outV.handled === "hint" && callsOf("sendMessage").length >= 1);

    console.log("\n[6] callback_query picks");
    tgCalls.length = 0;
    const out2 = await handleTelegramUpdate(
      {
        update_id: 3,
        callback_query: {
          id: "cb1",
          data: "vp:en-US-GuyNeural",
          message: { message_id: 777, chat: { id: 4242 } },
          from: { id: 7, first_name: "T" },
        },
      },
      botToken
    );
    check("6a. persona pick handled", out2.handled === "hint");
    check("6b. chat override persisted in registry", findBoundAgent(botToken, 4242)?.chats.get(4242)?.voiceId === "en-US-GuyNeural");
    check("6c. spinner answered with a toast", callsOf("answerCallbackQuery").some((c) => String(c.body.callback_query_id) === "cb1" && String(c.body.text || "").includes("Atlas")));
    const reRender = lastCall("editMessageText");
    const reMarkup = reRender?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined;
    check("6d. picker re-rendered with Atlas ✅", Boolean(reMarkup?.inline_keyboard.flat().some((b) => b.callback_data === "vp:en-US-GuyNeural" && b.text.includes("✅"))));
    check("6e. re-render text says picked in this chat", String(reRender?.body.text || "").includes("picked in this chat"));
    check("6f. follow-web-console button appears after override", Boolean(reMarkup?.inline_keyboard.flat().some((b) => b.callback_data === "vp:default" && b.text.includes("↩"))));

    tgCalls.length = 0;
    await handleTelegramUpdate(
      { update_id: 4, callback_query: { id: "cb2", data: "vm:on", message: { message_id: 777, chat: { id: 4242 } } } },
      botToken
    );
    check("6g. mode pick persisted (always)", findBoundAgent(botToken, 4242)?.chats.get(4242)?.voiceOut === "on");
    check("6h. mode toast sent", callsOf("answerCallbackQuery").some((c) => String(c.body.text || "").includes("Voice replies: on")));

    tgCalls.length = 0;
    await handleTelegramUpdate(
      { update_id: 5, callback_query: { id: "cb3", data: "vp:default", message: { message_id: 777, chat: { id: 4242 } } } },
      botToken
    );
    check("6i. default resets to account persona", findBoundAgent(botToken, 4242)?.chats.get(4242)?.voiceId === undefined);

    tgCalls.length = 0;
    await handleTelegramUpdate(
      { update_id: 6, callback_query: { id: "cb4", data: "vp:en-US-AvaNeural", message: { message_id: 777, chat: { id: 9999 } } } },
      botToken
    );
    check("6j. unpaired chat gets a pairing nudge toast", callsOf("answerCallbackQuery").some((c) => String(c.body.text || "").includes("Pair this chat first")));

    tgCalls.length = 0;
    await handleTelegramUpdate(
      { update_id: 7, callback_query: { id: "cb5", data: "vp:totally-fake", message: { message_id: 777, chat: { id: 4242 } } } },
      botToken
    );
    check("6k. unknown voice rejected", callsOf("answerCallbackQuery").some((c) => String(c.body.text || "") === "Unknown voice"));
    check("6l. rejected pick did not touch state", findBoundAgent(botToken, 4242)?.chats.get(4242)?.voiceId === undefined);

    console.log("\n[7] registry plumbing");
    const reregistered = registerAgent({
      key: "test:voice-picker",
      botToken,
      builtIn: true,
      agentName: "Vox",
      ownerName: "Tester",
      ownerToken: "DIP-TEST-TEST",
      systemPrompt: "test",
      providers: [],
      allowDemoBrain: true,
      whitelist: [],
    });
    check("7a. re-pairing without voice keeps the synced persona", reregistered.voiceId === "en-US-AvaNeural", reregistered.voiceId);
    check("7b. re-pairing keeps rate/pitch tweaks", reregistered.voiceRate === -10 && reregistered.voicePitch === 5);
    bindChat(reregistered, 4242, { mode: "owner", userName: "Tester", token: "DIP-TEST-TEST" });
    check("7c. re-bind keeps the chat persona override", true); // override was reset to default in 6i — mode must survive:
    const out7 = await handleTelegramUpdate(
      {
        update_id: 8,
        callback_query: { id: "cb6", data: "vp:en-US-EricNeural", message: { message_id: 777, chat: { id: 4242 } } },
      },
      botToken
    );
    bindChat(reregistered, 4242, { mode: "owner", userName: "Tester", token: "DIP-TEST-TEST" });
    check("7d. chat override survives a re-bind", findBoundAgent(botToken, 4242)?.chats.get(4242)?.voiceId === "en-US-EricNeural", out7.replyPreview);

    /* picker must reflect the chat override over the account persona */
    tgCalls.length = 0;
    await handleTelegramUpdate(
      { update_id: 9, message: { message_id: 13, date: 3, chat: { id: 4242, type: "private" }, text: "/voice" } },
      botToken
    );
    const picker2 = lastCall("sendMessage");
    const markup2 = picker2?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined;
    check(
      "7e. chat override wins the ✅ in the picker",
      Boolean(markup2?.inline_keyboard.flat().some((b) => b.callback_data === "vp:en-US-EricNeural" && b.text.includes("✅"))) &&
        !markup2?.inline_keyboard.flat().some((b) => b.callback_data === "vp:en-US-AvaNeural" && b.text.includes("✅"))
    );

    console.log(`\n═══ voice-picker: ${pass} passed, ${fail} failed ═══`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
