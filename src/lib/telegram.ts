import { getZAI } from "./zai";
import {
  agentsForBot,
  bindChat,
  dueReminders,
  findBoundAgent,
  findByPairingToken,
  markRemindersDone,
  pushThread,
  recordReply,
  refreshRegistry,
  touchAgent,
  type ChatMsg,
  type ChatState,
  type RegisteredAgent,
  type TokenMatch,
} from "./agent-registry";
import { runAgentChainStreaming } from "./brain";
import { brainSignature } from "./brains";
import { transcribeAudio } from "./asr";
import { extractVoiceBlocks, mdToSpeechText, synthesizeVoice, type VoiceOutMode } from "./voice-out";
import { personaByVoice, personaLabel, VOICE_PERSONAS } from "./voice-personas";

/** voice ids in picker order (module-level — the catalog is static) */
const VOICE_PERSONA_IDS = VOICE_PERSONAS.map((p) => p.voice);
import type { GatewayChat } from "./types";
import {
  extractFileAttachments,
  htmlToPlain,
  markdownToTelegramHTML,
  plainPreview,
  splitTelegramHtml,
  type CodeFile,
} from "./telegram-format";

/* Media links produced by the image_gen / tts tools are converted into
 * real Telegram media messages instead of raw URLs. */
interface MediaRef {
  url: string;
  caption?: string;
}

function extractMediaLinks(md: string): {
  text: string;
  photos: MediaRef[];
  audios: MediaRef[];
} {
  const photos: MediaRef[] = [];
  const audios: MediaRef[] = [];
  let text = md.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_m, alt, url) => {
    photos.push({ url, caption: alt || undefined });
    return "";
  });
  text = text.replace(/(?:🎙\s*)?(?:voice note|voice message|audio)\s*:\s*(https?:\/\/[^\s)]+)/gi, (_m, url) => {
    audios.push({ url, caption: undefined });
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), photos, audios };
}

/* ============================================================
 * Telegram gateway — real message handling for paired bots
 * ============================================================ */

export const BUILTIN_BOT_TOKEN =
  process.env.BUILTIN_TELEGRAM_BOT_TOKEN ||
  "8873089413:AAHNPPQuTk3M7zLP1AVaw6U9LhKBT07HOoM";
export const BUILTIN_BOT_USERNAME = "init_smart_bot";

const TG_TIMEOUT_MS = 20_000;

function tgUrl(token: string, method: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function tgCall<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = TG_TIMEOUT_MS
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(tgUrl(token, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
      cache: "no-store",
    });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } finally {
    clearTimeout(t);
  }
}

export async function tgGetMe(token: string) {
  return tgCall<{ id: number; username?: string; first_name?: string }>(token, "getMe");
}

export async function tgSetWebhook(token: string, url: string) {
  return tgCall<boolean>(token, "setWebhook", {
    url,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

export async function tgDeleteWebhook(token: string) {
  return tgCall<boolean>(token, "deleteWebhook", { drop_pending_updates: false });
}

export async function tgGetUpdates(token: string, offset: number) {
  return tgCall<{ update_id: number; message?: TelegramMessage }[]>(token, "getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message", "callback_query"],
  });
}

export async function tgSendChatAction(token: string, chatId: number, action = "typing") {
  try {
    await tgCall(token, "sendChatAction", { chat_id: chatId, action }, 8_000);
  } catch {
    /* non-fatal */
  }
}

/* ---------------- media helpers (Hermes/OpenClaw-grade media delivery) ---------------- */

/** Download a file from Telegram by file_id (≤20 MB Bot API limit). */
export async function tgGetFileBytes(token: string, fileId: string): Promise<Buffer | null> {
  try {
    const meta = await tgCall<{ file_path?: string }>(token, "getFile", { file_id: fileId }, 15_000);
    if (!meta.ok || !meta.result?.file_path) return null;
    const url = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

async function tgMultipartSend(
  token: string,
  method: string,
  fileField: string,
  bytes: Uint8Array,
  filename: string,
  extra: Record<string, string>
): Promise<boolean> {
  try {
    const form = new FormData();
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    form.append(
      fileField,
      new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }),
      filename
    );
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
    try {
      const res = await fetch(tgUrl(token, method), { method: "POST", body: form, signal: controller.signal, cache: "no-store" });
      return (await res.json() as { ok?: boolean }).ok === true;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

export async function tgSendPhoto(token: string, chatId: number, url: string, caption?: string): Promise<boolean> {
  try {
    const r = await tgCall(token, "sendPhoto", {
      chat_id: chatId,
      photo: url,
      ...(caption ? { caption: caption.slice(0, 1000) } : {}),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function tgSendVoiceBytes(token: string, chatId: number, bytes: Uint8Array, caption?: string): Promise<boolean> {
  return tgMultipartSend(token, "sendVoice", "voice", bytes, "voice.ogg", {
    chat_id: String(chatId),
    ...(caption ? { caption: caption.slice(0, 1000) } : {}),
  });
}

export async function tgSendAudioBytes(token: string, chatId: number, bytes: Uint8Array, title?: string): Promise<boolean> {
  return tgMultipartSend(token, "sendAudio", "audio", bytes, "audio.mp3", {
    chat_id: String(chatId),
    ...(title ? { title: title.slice(0, 60) } : {}),
  });
}

export async function tgSendMessage(token: string, chatId: number, text: string) {
  // Telegram hard limit is 4096 chars per message — split politely.
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 3800) {
    let cut = rest.lastIndexOf("\n", 3800);
    if (cut < 800) cut = 3800;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  chunks.push(rest);
  for (const chunk of chunks) {
    await tgCall(token, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

/** Close a callback-query spinner (must happen within a few seconds). */
async function tgAnswerCallback(token: string, callbackQueryId: string, text?: string) {
  try {
    await tgCall(token, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text: text.slice(0, 190), show_alert: false } : {}),
    }, 8_000);
  } catch {
    /* non-fatal — the toast is cosmetic */
  }
}

/**
 * Send a real file document (long code blocks are delivered as files,
 * never as chat walls). Multipart upload, UTF-8 text payload.
 */
export async function tgSendDocument(
  token: string,
  chatId: number,
  file: CodeFile
): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append(
      "document",
      new Blob([file.content], { type: "text/plain; charset=utf-8" }),
      file.filename
    );
    form.append("caption", `${file.filename} · ${file.lines} lines`);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
    let ok = false;
    try {
      const res = await fetch(tgUrl(token, "sendDocument"), {
        method: "POST",
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
      ok = (await res.json() as { ok?: boolean }).ok === true;
    } finally {
      clearTimeout(t);
    }
    if (!ok) {
      // fallback: never lose the code — paste as chat text (chunked)
      await tgSendMessage(token, chatId, `📎 ${file.filename}:
${file.content}`);
    }
    return ok;
  } catch {
    try {
      await tgSendMessage(token, chatId, `📎 ${file.filename}:
${file.content}`);
    } catch {
      /* channel down */
    }
    return false;
  }
}

/**
 * Synthesize text and deliver it as a REAL Telegram voice note (the
 * waveform bubble, not an audio-file player). Falls back voice → audio;
 * returns false only when both uploads fail.
 */
async function deliverVoiceNote(
  token: string,
  chatId: number,
  speakText: string,
  caption?: string,
  persona?: { voiceId?: string | null; rate?: number; pitch?: number }
): Promise<boolean> {
  const synth = await synthesizeVoice(speakText, persona);
  if (!synth.ok || !synth.bytes?.length) {
    return false;
  }
  if (await tgSendVoiceBytes(token, chatId, synth.bytes, caption)) return true;
  // sendVoice rejected the payload — the audio player still delivers it
  return tgSendAudioBytes(token, chatId, synth.bytes, caption || "voice note");
}

/**
 * Deterministic VoiceOut delivery — the single path every agent reply takes:
 *  1. <tts>/<voice>/<audio> blocks the model emitted are extracted and sent
 *     as REAL voice notes (hallucinated protocols come true; tags never leak)
 *  2. the cleaned reply is sent as formatted text
 *  3. when `speak` is set (voice mirror mode), the whole reply is spoken back
 *     as a voice note — user talks, the agent talks
 * Text always goes out first, so the user never loses content if TTS fails;
 * if a voice block cannot be synthesized its text re-joins the chat.
 */
async function deliverReply(
  agent: RegisteredAgent,
  chatId: number,
  md: string,
  opts?: { editMessageId?: number; speak?: boolean; voiceId?: string | null }
): Promise<string> {
  const { text: cleaned, voiceTexts } = extractVoiceBlocks(md);
  const persona = {
    voiceId: opts?.voiceId,
    rate: agent.voiceRate ?? 0,
    pitch: agent.voicePitch ?? 0,
  };

  await sendFormatted(agent.botToken, chatId, cleaned, opts?.editMessageId);

  // explicit voice blocks → individual voice notes (text re-joins on failure)
  const failedBlocks: string[] = [];
  for (const vt of voiceTexts) {
    const spoken = await deliverVoiceNote(agent.botToken, chatId, mdToSpeechText(vt), undefined, persona);
    if (!spoken) failedBlocks.push(vt);
  }

  // voice mirror — the reply itself, spoken (only when the model didn't
  // already voice the answer via explicit blocks — never double-speak)
  if (opts?.speak && cleaned && !voiceTexts.length) {
    await deliverVoiceNote(agent.botToken, chatId, mdToSpeechText(cleaned), undefined, persona);
  }

  if (failedBlocks.length) {
    await tgSendMessage(
      agent.botToken,
      chatId,
      `🔊 (voice synthesis unavailable — as text:)\n\n${failedBlocks.join("\n\n")}`.slice(0, 3800)
    );
  }
  return cleaned;
}

/* ---------------- voice persona picker (same catalog as the web console) ---------------- */

/** Short button label, e.g. "🌟 Nova" (full name is too wide for a button). */
function personaButtonLabel(voiceId: string, active: boolean): string {
  const p = personaByVoice(voiceId);
  const base = p ? `${p.emoji} ${p.name.split(" — ")[0]}` : voiceId;
  return active ? `${base} ✅` : base;
}

/** The picker message text — shows the currently active persona. */
function voicePickerText(chatVoiceId: string | undefined, agentVoiceId: string | undefined): string {
  const active = chatVoiceId ?? agentVoiceId;
  const source = chatVoiceId ? "(picked in this chat)" : agentVoiceId ? "(synced from the web console)" : "(default)";
  return [
    "🎙 Voice persona — how I sound",
    `Current: ${personaLabel(active)} ${source}`.trim(),
    "",
    "Tap a persona to switch instantly — same voices as the web console picker.",
    "Cyrillic and Hebrew replies automatically use a native voice of the same style.",
  ].join("\n");
}

function voicePickerMarkup(chatVoiceId: string | undefined, agentVoiceId: string | undefined, mode: VoiceOutMode) {
  const active = chatVoiceId ?? agentVoiceId;
  const personaButtons = VOICE_PERSONA_IDS.map((v) => ({
    text: personaButtonLabel(v, active === v),
    callback_data: `vp:${v}`,
  }));
  // 2 personas per row, like the web popover's list
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < personaButtons.length; i += 2) rows.push(personaButtons.slice(i, i + 2));
  rows.push([
    { text: chatVoiceId ? "↩ Follow web console" : "🔹 Default voice ✅", callback_data: "vp:default" },
  ]);
  const modeLabel = (m: VoiceOutMode, label: string) => ({
    text: mode === m ? `${label} ✅` : label,
    callback_data: `vm:${m}`,
  });
  rows.push([modeLabel("auto", "🎤 auto"), modeLabel("on", "🎙 always"), modeLabel("off", "💬 off")]);
  return { inline_keyboard: rows };
}

/** Send (or re-render) the voice persona picker with inline buttons. */
async function sendVoicePicker(
  token: string,
  chatId: number,
  chatVoiceId: string | undefined,
  agentVoiceId: string | undefined,
  mode: VoiceOutMode,
  editMessageId?: number
): Promise<void> {
  const body = {
    chat_id: chatId,
    text: voicePickerText(chatVoiceId, agentVoiceId),
    reply_markup: voicePickerMarkup(chatVoiceId, agentVoiceId, mode),
    disable_web_page_preview: true,
  };
  const r = editMessageId
    ? await tgCall(token, "editMessageText", { ...body, message_id: editMessageId })
    : await tgCall(token, "sendMessage", body);
  if (!r.ok && editMessageId) {
    // message too old to edit → send a fresh picker instead
    await tgCall(token, "sendMessage", body);
  }
}

const EDIT_MIN_INTERVAL_MS = 1_600; // Telegram rate-friendliness
const EDIT_MIN_NEW_CHARS = 48;

/**
 * Send (or edit-in-place) a markdown-ish reply as Telegram HTML with
 * code-block rendering, fence-aware chunking and a plain-text fallback
 * when Telegram rejects the entities — formatting is never silently lost.
 * Long code walls never hit the chat: they are extracted and delivered
 * as real file documents right after the text. Media (generated images,
 * voice notes) referenced in the reply are sent as real photo/audio/
 * voice messages.
 */
export async function sendFormatted(
  token: string,
  chatId: number,
  md: string,
  editMessageId?: number
) {
  const { md: stripped, files } = extractFileAttachments(md);
  const { text: mediaText, photos, audios } = extractMediaLinks(stripped);
  const html = markdownToTelegramHTML(mediaText);
  const chunks = splitTelegramHtml(html);
  for (let i = 0; i < chunks.length; i++) {
    const useEdit = Boolean(editMessageId) && i === 0;
    const method = useEdit ? "editMessageText" : "sendMessage";
    const base = useEdit
      ? { chat_id: chatId, message_id: editMessageId }
      : { chat_id: chatId };
    const r = await tgCall(token, method, {
      ...base,
      text: chunks[i],
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!r.ok) {
      const plain = htmlToPlain(chunks[i]).slice(0, 3900);
      await tgCall(token, method, { ...base, text: plain, disable_web_page_preview: true });
    }
  }
  for (const p of photos) {
    const sent = await tgSendPhoto(token, chatId, p.url, p.caption);
    if (!sent) {
      await tgSendMessage(token, chatId, `🖼 ${p.caption || p.url}`);
    }
  }
  for (const a of audios) {
    let bytes: Buffer | null = null;
    if (a.url.startsWith("http")) {
      try {
        const res = await fetch(a.url, { cache: "no-store" });
        if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
      } catch {
        bytes = null;
      }
    }
    if (bytes) {
      // voice-note bubble first (ogg/wav/mp3 all accepted by Telegram and
      // transcoded server-side); audio-player fallback if sendVoice refuses
      if (/\.(ogg|wav|mp3|m4a|opus)$/i.test(a.url)) {
        const sent = await tgSendVoiceBytes(token, chatId, new Uint8Array(bytes), a.caption);
        if (!sent) await tgSendAudioBytes(token, chatId, new Uint8Array(bytes), a.caption || "voice note");
      } else {
        await tgSendAudioBytes(token, chatId, new Uint8Array(bytes), a.caption || "voice note");
      }
    } else if (a.url.startsWith("http")) {
      await tgSendMessage(token, chatId, a.url);
    }
  }
  for (const file of files) {
    await tgSendDocument(token, chatId, file);
  }
}

interface StreamReplyResult {
  text: string;
  ok: boolean;
  error?: string;
}

/**
 * Hermes/OpenClaw-grade streaming:
 *  1. Bot API 9.5 sendMessageDraft when available (live animated draft —
 *     the same primitive Hermes/OpenClaw stream through),
 *  2. fallback: placeholder message + throttled editMessageText,
 *  3. typing action renewed every ~4s until the first tokens land,
 *  4. final edit/send swaps in fully formatted HTML + media + files.
 */
async function streamReplyToChat(
  agent: RegisteredAgent,
  chatId: number,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts?: { toolCtx?: { agentKey?: string; chatId?: number }; speak?: boolean; voiceId?: string | null }
): Promise<StreamReplyResult> {
  const token = agent.botToken;

  const typing: ReturnType<typeof setInterval> | null = setInterval(() => {
    void tgSendChatAction(token, chatId);
  }, 4_200);
  const stopTyping = () => {
    if (typing) clearInterval(typing);
  };

  const st = {
    previewSent: false,
    draftMode: false,
    messageId: 0,
    lastEditAt: 0,
    lastLen: 0,
    /** in-flight claim of the stream surface (draft → placeholder).
     * The final send ALWAYS awaits this — otherwise fast replies race
     * the placeholder round-trip and the user gets the reply TWICE
     * (placeholder message + final message). */
    surface: null as Promise<void> | null,
  };

  /** Claim the streaming surface exactly once: try a Bot API 9.5 draft;
   * if drafts are unsupported, plant an editable placeholder message. */
  const claimSurface = (full: string) => {
    if (!st.surface) {
      st.surface = (async () => {
        try {
          const r = await tgCall(token, "sendMessageDraft", { chat_id: chatId, text: plainPreview(full, 1200) }, 8_000);
          if (r.ok) {
            st.draftMode = true;
            return;
          }
        } catch {
          /* draft unsupported / network hiccup → editable placeholder */
        }
        try {
          const pr = await tgCall(token, "sendMessage", {
            chat_id: chatId,
            text: plainPreview(full, 1200),
            disable_web_page_preview: true,
          });
          const id = (pr.result as { message_id?: number } | undefined)?.message_id;
          if (pr.ok && typeof id === "number") st.messageId = id;
        } catch {
          /* final send happens as a fresh message */
        }
      })();
    }
    return st.surface;
  };

  const result = await runAgentChainStreaming({
    providers: agent.providers,
    messages,
    allowDemoBrain: agent.allowDemoBrain,
    brains: agent.brains,
    toolCtx: opts?.toolCtx || { agentKey: agent.key, chatId },
    onEvent: (ev) => {
      if (ev.type !== "delta") return;
      const full = ev.text;
      if (!st.previewSent) {
        // wait for a meaningful first fragment, then claim the stream surface
        if (full.trim().length < 30) return;
        st.previewSent = true;
        stopTyping();
        void claimSurface(full);
        return;
      }
      const now = Date.now();
      if (
        now - st.lastEditAt >= EDIT_MIN_INTERVAL_MS &&
        full.length - st.lastLen >= EDIT_MIN_NEW_CHARS
      ) {
        st.lastEditAt = now;
        st.lastLen = full.length;
        if (st.draftMode) {
          void tgCall(token, "sendMessageDraft", { chat_id: chatId, text: plainPreview(full) + " ▌" }, 8_000).catch(() => {});
        } else if (st.messageId) {
          void tgCall(token, "editMessageText", {
            chat_id: chatId,
            message_id: st.messageId,
            text: plainPreview(full) + " ▌",
            disable_web_page_preview: true,
          }).catch(() => {});
        }
      }
    },
  });
  stopTyping();

  if (!result.ok || !result.content) {
    const errText = `⚠ All brains failed to answer just now. Last error: ${
      result.fallbackChain.at(-1)?.error || result.error || "unknown"
    }`;
    // a claimed surface may already show a preview — finalize it, never send twice
    if (st.previewSent && st.surface) await st.surface;
    if (st.messageId) {
      const edited = await tgCall(token, "editMessageText", {
        chat_id: chatId,
        message_id: st.messageId,
        text: errText.slice(0, 3800),
        disable_web_page_preview: true,
      });
      if (!edited.ok) await tgSendMessage(token, chatId, errText);
    } else if (!st.draftMode) {
      // draft-only previews vanish — the user still needs the failure notice
      await tgSendMessage(token, chatId, errText);
    }
    return { text: errText, ok: false, error: result.error };
  }

  const reply = result.content;

  if (st.previewSent) {
    // ⏱ THE duplicate-reply fix: wait out the in-flight surface claim
    // before deciding to edit (placeholder exists) or send (none yet).
    await st.surface;
  }
  if (st.previewSent && st.messageId) {
    // finalize: swap the preview for the fully formatted version (chunk-aware)
    await deliverReply(agent, chatId, reply, { editMessageId: st.messageId, speak: opts?.speak, voiceId: opts?.voiceId });
  } else {
    // no real message on the surface yet (draft-only or no preview) — send once
    await deliverReply(agent, chatId, reply, { speak: opts?.speak, voiceId: opts?.voiceId });
  }
  return { text: reply, ok: true };
}

/** Minimal local shape of the SDK's vision body (its types are strict). */
interface CreateChatCompletionVisionShape {
  messages: unknown[];
}

/* ---------------- update handling ---------------- */

export interface TelegramPhotoSize {
  file_id: string;
  width?: number;
  height?: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string; language_code?: string };
  chat: { id: number; type: string; first_name?: string; title?: string };
  text?: string;
  caption?: string;
  date: number;
  voice?: { file_id: string; duration?: number; mime_type?: string };
  audio?: { file_id: string; duration?: number; mime_type?: string; title?: string };
  photo?: TelegramPhotoSize[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  from?: { id: number; first_name?: string; language_code?: string };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/** Matches "/start", "/start DIP-...", "dip-7k2m-9qx4" etc. */
const TOKEN_RE = /DIP-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}/i;

export interface UpdateOutcome {
  handled: "chat" | "pair" | "hint" | "ignored";
  replyPreview?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Blob storage is eventually consistent: an agent freshly registered on
 * another instance may not be visible yet. Retry with a forced registry
 * refresh before giving up — this heals the race between pairing in the
 * portal and the first Telegram message arriving via webhook.
 */
async function lookupWithRetry(botToken: string, token: string): Promise<TokenMatch | undefined> {
  const first = findByPairingToken(botToken, token);
  if (first) return first;
  const delays = [400, 900];
  for (const d of delays) {
    await sleep(d);
    await refreshRegistry({ force: true });
    const match = findByPairingToken(botToken, token);
    if (match) return match;
  }
  return undefined;
}

function contextLine(agent: RegisteredAgent, mode: string, userName: string): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const sig = brainSignature(agent.brains);
  const base = `\n\n[Context: current time is ${now}. ${
    agent.presetId ? `Active preset: ${agent.presetId}. ` : ""
  }${sig ? `Active brains: ${sig}. ` : ""}${
    (agent.memory?.length ?? 0) > 0 ? `You have ${agent.memory?.length} long-term memories (use recall).` : ""
  }]`;
  if (mode === "owner") {
    return `\n\n[Context: you are chatting with ${agent.ownerName} — your owner and operator, via Telegram. This is the main shared thread.]${base}`;
  }
  if (mode === "shared") {
    return `\n\n[Context: you are chatting with ${userName} — a whitelisted user invited by ${agent.ownerName}. You share memory and context with ${agent.ownerName}'s main thread.]${base}`;
  }
  return `\n\n[Context: you are chatting with ${userName} — a whitelisted user invited by ${agent.ownerName}. This conversation is ISOLATED: keep it self-contained and private to ${userName}.]${base}`;
}

/* ---------------- media intake (voice → ASR, photo → vision) ---------------- */

interface Intake {
  text: string;
  note?: string;
}

/**
 * Transcribe an incoming Telegram voice/audio note.
 * Keyless cloud ASR (ogg/opus → WAV → Google Web Speech) with the
 * z-ai SDK tier as fallback — works on every deployment.
 */
async function transcribeTelegramVoice(
  botToken: string,
  msg: TelegramMessage
): Promise<Intake | null> {
  const fileId = msg.voice?.file_id || msg.audio?.file_id;
  if (!fileId) return null;
  const bytes = await tgGetFileBytes(botToken, fileId);
  if (!bytes) return { text: "", note: "I couldn't download that voice note — please try again or type it." };
  const mime = msg.voice?.mime_type || msg.audio?.mime_type || "";
  const lang = msg.from?.language_code || "en";
  try {
    const r = await transcribeAudio(bytes, mime, lang);
    if (r.text) {
      return { text: r.text, note: `[voice note from ${msg.from?.first_name || "user"}]` };
    }
    return {
      text: "",
      note:
        r.error === "no speech recognized"
          ? "I couldn't make out the audio — could you type it?"
          : `Voice transcription hit a snag (${r.error || "unknown"}) — please type it and I'll take it from there.`,
    };
  } catch {
    return {
      text: "",
      note: "Voice transcription is unavailable right now — type your message and I'll take it from there.",
    };
  }
}

/** Describe an incoming photo: providers with vision first, built-in vision fallback. */
async function describeTelegramPhoto(
  botToken: string,
  msg: TelegramMessage
): Promise<Intake | null> {
  const sizes = msg.photo || [];
  if (!sizes.length) return null;
  const largest = sizes.reduce((a, b) =>
    (b.file_size || 0) > (a.file_size || 0) ? b : a
  );
  const bytes = await tgGetFileBytes(botToken, largest.file_id);
  if (!bytes) return { text: msg.caption?.trim() || "", note: "I couldn't download that photo — try resending it." };
  const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  const caption = msg.caption?.trim() || "Describe this image for me in detail.";
  // 1) built-in vision (works where .z-ai-config exists)
  try {
    const zai = await getZAI();
    const visionBody = {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: caption },
          ],
        },
      ],
    };
    const completion = await zai.chat.completions.createVision(
      visionBody as unknown as Parameters<typeof zai.chat.completions.createVision>[0]
    );
    const anyRes = completion as {
      choices?: { message?: { content?: string } }[];
      content?: string;
    };
    const content = anyRes?.choices?.[0]?.message?.content ?? anyRes?.content ?? "";
    if (typeof content === "string" && content.trim()) {
      return {
        text: `[photo attached] The image analysis says: ${content.trim().slice(0, 1200)}\n\nUser question/caption: ${caption}`,
      };
    }
  } catch {
    /* no built-in vision on this deployment */
  }
  return {
    text: caption,
    note: "Photo received — but image understanding isn't available on this deployment (no vision brain configured). Tell me what's in it and I'll help.",
  };
}

async function replyAndRecord(agent: RegisteredAgent, chatId: number, text: string) {
  await tgSendMessage(agent.botToken, chatId, text);
  recordReply(agent, chatId, text);
  touchAgent(agent);
}

/** Deliver any reminders that came due, then mark them done. */
async function flushDueReminders(agent: RegisteredAgent): Promise<void> {
  const due = dueReminders(agent);
  if (!due.length) return;
  for (const r of due) {
    const body = `⏰ *Reminder*: ${r.text}`;
    await sendFormatted(agent.botToken, r.chatId, body).catch(() => undefined);
  }
  markRemindersDone(
    agent,
    due.map((r) => r.id)
  );
  touchAgent(agent);
}

/** Slash commands — Hermes-style central registry, handled before the LLM. */
async function handleCommand(
  agent: RegisteredAgent,
  chat: ChatState,
  text: string
): Promise<UpdateOutcome | null> {
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "");
  if (cmd === "/reset") {
    if (chat.mode === "isolated") chat.thread = [];
    else agent.sharedThread = [];
    await replyAndRecord(agent, chat.chatId, `Memory cleared for this thread (${chat.mode} context). Fresh start — what's next?`);
    return { handled: "hint", replyPreview: "thread reset" };
  }
  if (cmd === "/voice" || cmd === "/voices") {
    // full persona picker — the same catalog as the web console popover,
    // with the voice-reply mode row on the bottom (auto / always / off)
    await sendVoicePicker(
      agent.botToken,
      chat.chatId,
      chat.voiceId,
      agent.voiceId,
      chat.voiceOut ?? "auto"
    );
    return { handled: "hint", replyPreview: "voice picker sent" };
  }
  if (cmd === "/help") {
    await replyAndRecord(
      agent,
      chat.chatId,
      [
        `${agent.agentName} — your personal agent (Deep-init AI)`,
        "",
        "Just talk to me: ask questions, send tasks, paste text, forward links.",
        "🎤 Voice notes → I transcribe and answer — and talk back (send /voice to switch modes).",
        "📷 Photos → I analyze them.",
        "",
        "Tools I can run: live web search, page reading, image search & generation, voice notes (TTS), long-term memory, scheduled reminders. Long code arrives as files.",
        "",
        "Commands:",
        "/status — what I am and what's wired",
        "/voice — voice settings: persona picker + reply mode (same voices as the web console)",
        "/reset — clear this thread's memory",
        "/help — this list",
      ].join("\n"),
    );
    return { handled: "hint", replyPreview: "/help" };
  }
  if (cmd === "/status") {
    const prov = agent.providers.length
      ? agent.providers.map((p) => `${p.label || p.model}${p.model ? ` (${p.model})` : ""}`).join(", ")
      : "built-in demo brain";
    const pending = (agent.reminders ?? []).filter((r) => !r.done).length;
    await replyAndRecord(
      agent,
      chat.chatId,
      [
        `⚙ ${agent.agentName} — status`,
        `• Owner: ${agent.ownerName}`,
        `• Your context: ${chat.mode}${agent.presetId ? ` • preset: ${agent.presetId}` : ""}`,
        `• Brains: ${prov}`,
        `• Tools: web_search, web_fetch, image_search, image_gen, tts, remember/recall, remind`,
        `• Memory: ${(agent.memory ?? []).length} facts • Pending reminders: ${pending}`,
        `• Deliverables: formatted markdown, code files, images, voice notes`,
      ].join("\n"),
    );
    return { handled: "hint", replyPreview: "/status" };
  }
  if (cmd.startsWith("/")) {
    await replyAndRecord(agent, chat.chatId, `Unknown command ${cmd}. Try /help — or just talk to me normally.`);
    return { handled: "hint", replyPreview: cmd };
  }
  return null;
}

/**
 * Inline-keyboard button presses (voice persona / reply-mode picker).
 * vp:<voice|default> — persona pick; vm:<mode> — voice-reply mode pick.
 */
async function handleVoiceCallback(
  botToken: string,
  cb: TelegramCallbackQuery
): Promise<UpdateOutcome> {
  const chatId = cb.message?.chat.id;
  if (!chatId) return { handled: "ignored" };

  const agent = findBoundAgent(botToken, chatId);
  if (!agent) {
    await tgAnswerCallback(botToken, cb.id, "Pair this chat first — send your pairing token.");
    return { handled: "hint", replyPreview: "callback from unpaired chat" };
  }
  const chat = agent.chats.get(chatId);
  if (!chat) return { handled: "ignored" };

  const data = (cb.data || "").trim();
  const vp = data.match(/^vp:(.+)$/);
  const vm = data.match(/^vm:(auto|on|off)$/);

  if (vp) {
    const voiceId = vp[1] === "default" ? undefined : vp[1];
    if (voiceId && !personaByVoice(voiceId)) {
      await tgAnswerCallback(botToken, cb.id, "Unknown voice");
      return { handled: "hint", replyPreview: `unknown voice ${vp[1]}` };
    }
    chat.voiceId = voiceId;
    touchAgent(agent);
    await tgAnswerCallback(botToken, cb.id, `Voice: ${personaLabel(chat.voiceId ?? agent.voiceId)}`);
    await sendVoicePicker(botToken, chatId, chat.voiceId, agent.voiceId, chat.voiceOut ?? "auto", cb.message?.message_id);
    return { handled: "hint", replyPreview: `voice → ${chat.voiceId ?? "default"}` };
  }

  if (vm) {
    const mode = vm[1] as VoiceOutMode;
    chat.voiceOut = mode;
    touchAgent(agent);
    const label =
      mode === "auto"
        ? "you talk, I talk back (plus text)"
        : mode === "on"
          ? "every reply arrives as a voice note"
          : "replies are text only";
    await tgAnswerCallback(botToken, cb.id, `Voice replies: ${mode} — ${label}`);
    await sendVoicePicker(botToken, chatId, chat.voiceId, agent.voiceId, mode, cb.message?.message_id);
    return { handled: "hint", replyPreview: `voiceOut → ${mode}` };
  }

  await tgAnswerCallback(botToken, cb.id);
  return { handled: "ignored" };
}

/**
 * Processes one Telegram update against the gateway registry.
 * This is the single code path shared by webhook + poll bridge.
 */
export async function handleTelegramUpdate(
  update: TelegramUpdate,
  botToken: string
): Promise<UpdateOutcome> {
  /* 0) inline-keyboard button presses (voice persona picker) */
  if (update.callback_query?.data) {
    return handleVoiceCallback(botToken, update.callback_query);
  }

  const msg = update.message || update.edited_message;
  if (!msg) return { handled: "ignored" };

  const chatId = msg.chat.id;
  let text = msg.text?.trim() || "";

  /* 0) media intake — voice/audio → ASR, photo → vision (Hermes/OpenClaw parity) */
  if (!text && (msg.voice || msg.audio)) {
    const intake = await transcribeTelegramVoice(botToken, msg);
    if (intake?.note && !intake.text) {
      const nudge = findBoundAgent(botToken, chatId);
      if (nudge) await replyAndRecord(nudge, chatId, intake.note);
      return { handled: "hint", replyPreview: "voice intake failed" };
    }
    if (intake) {
      text = [intake.note, intake.text].filter(Boolean).join(" ");
    }
  } else if (!text && msg.photo) {
    const intake = await describeTelegramPhoto(botToken, msg);
    if (!intake) return { handled: "ignored" };
    if (intake.note && !intake.text) {
      const nudge = findBoundAgent(botToken, chatId);
      if (nudge) await replyAndRecord(nudge, chatId, intake.note);
      return { handled: "hint", replyPreview: "photo intake failed" };
    }
    text = [intake.note, intake.text].filter(Boolean).join(" ");
  } else if (!text) {
    return { handled: "ignored" };
  }

  /* 1) already-bound chat wins */
  let boundAgent = findBoundAgent(botToken, chatId);
  let boundChat = boundAgent?.chats.get(chatId);

  /* heal cross-instance staleness: re-pull the registry once before
     nudging an unbound sender (cheap — only when not yet paired) */
  if (!boundAgent && !/^\/start/i.test(text)) {
    await sleep(120);
    await refreshRegistry({ force: true });
    boundAgent = findBoundAgent(botToken, chatId);
    boundChat = boundAgent?.chats.get(chatId);
  }

  /* 2) pairing token in the message */
  const tokenMatch = text.match(TOKEN_RE);
  if (tokenMatch) {
    const match = await lookupWithRetry(botToken, tokenMatch[0]);
    if (!match) {
      if (boundAgent) {
        await replyAndRecord(
          boundAgent,
          chatId,
          "That token doesn't match this agent. Check the portal → Channels for valid tokens."
        );
        return { handled: "hint", replyPreview: "unknown token" };
      }
      return { handled: "hint", replyPreview: "unknown token (no agent for this bot)" };
    }
    const { agent, mode, userName } = match;
    bindChat(agent, chatId, { mode, userName, token: tokenMatch[0] });
    const greeting =
      mode === "owner"
        ? `Paired ✓\n\n${agent.agentName} online and at your service, ${agent.ownerName}. This Telegram chat is now my hotline to you — send tasks, questions or updates any time.`
        : `Paired ✓\n\nHi ${userName}! You've been invited to chat with ${agent.agentName}, ${agent.ownerName}'s personal agent. Your context mode: ${mode === "shared" ? "shared (we share the main memory)" : "isolated (your conversation stays private)"}. Say hello!`;
    await replyAndRecord(agent, chatId, greeting);
    return { handled: "pair", replyPreview: `paired ${userName} (${mode})` };
  }

  /* 3) /start — greet or instruct */
  if (/^\/start\b/i.test(text)) {
    if (boundAgent && boundChat) {
      await replyAndRecord(
        boundAgent,
        chatId,
        `${boundAgent.agentName} here — we're already paired, ${boundChat.userName}. What can I do for you?`
      );
      return { handled: "hint", replyPreview: "already paired" };
    }
    return { handled: "hint", replyPreview: "needs pairing token" };
  }

  /* 3b) slash commands — /help /status /reset */
  if (boundAgent && boundChat && /^\/\w/.test(text)) {
    const cmdOutcome = await handleCommand(boundAgent, boundChat, text);
    if (cmdOutcome) return cmdOutcome;
  }

  /* 4) chat message — streamed live to the chat (draft streaming) */
  if (boundAgent && boundChat) {
    const agent = boundAgent;
    agent.lastSeen = Date.now();
    boundChat.lastAt = Date.now();
    const thread: ChatMsg[] =
      boundChat.mode === "isolated" ? boundChat.thread : agent.sharedThread;
    pushThread(thread, { role: "user", content: text });

    const messages = [
      {
        role: "system" as const,
        content: agent.systemPrompt + contextLine(agent, boundChat.mode, boundChat.userName),
      },
      ...thread,
    ];

    /* VoiceOut: user spoke → the agent talks back (mode "auto"), or always
       when the chat is set to "on" — deterministic, model-independent.
       Persona: this chat's pick, else the account voice synced from the
       web console picker (Voice Persona Passport). */
    const spoken = Boolean(msg.voice || msg.audio);
    const voiceOut: VoiceOutMode = boundChat.voiceOut ?? "auto";
    const speak = voiceOut === "on" || (voiceOut === "auto" && spoken);
    const voiceId = boundChat.voiceId ?? agent.voiceId;

    const out = await streamReplyToChat(agent, chatId, messages, {
      toolCtx: { agentKey: agent.key, chatId },
      speak,
      voiceId,
    });

    pushThread(thread, { role: "assistant", content: out.text });
    recordReply(agent, chatId, out.text);
    touchAgent(agent);
    await flushDueReminders(agent);
    return {
      handled: "chat",
      replyPreview: out.text.slice(0, 120),
      error: out.ok ? undefined : out.error,
    };
  }

  /* 5) unbound chat — nudge toward pairing (only if some agent uses this bot) */
  const anyAgent = agentsForBot(botToken).length > 0;
  if (anyAgent) {
    const first = agentsForBot(botToken)[0];
    await tgSendMessage(
      botToken,
      chatId,
      `This is the hotline to ${first.agentName} (built with Deep-init AI). Send your Channel Pairing Token — it looks like DIP-XXXX-XXXX — to pair this chat.`
    );
  }
  return { handled: "hint", replyPreview: "unbound chat" };
}

/* ---------------- status ---------------- */

export function gatewayStatus(agent: RegisteredAgent): {
  chats: GatewayChat[];
  boundTokens: string[];
} {
  const chats: GatewayChat[] = [...agent.chats.values()].map((c) => ({
    chatId: c.chatId,
    userName: c.userName,
    mode: c.mode,
    boundAt: c.boundAt,
    lastAt: c.lastAt,
  }));
  const boundTokens = [...agent.chats.values()].map((c) => c.boundToken.toUpperCase());
  return { chats, boundTokens };
}
