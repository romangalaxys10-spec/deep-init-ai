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
    allowed_updates: ["message"],
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
    allowed_updates: ["message"],
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
      if (/\.ogg$/i.test(a.url)) {
        await tgSendVoiceBytes(token, chatId, bytes, a.caption);
      } else {
        await tgSendAudioBytes(token, chatId, bytes, a.caption || "voice note");
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
  toolCtx?: { agentKey?: string; chatId?: number }
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
    draftTried: false,
    messageId: 0,
    lastEditAt: 0,
    lastLen: 0,
  };

  const result = await runAgentChainStreaming({
    providers: agent.providers,
    messages,
    allowDemoBrain: agent.allowDemoBrain,
    brains: agent.brains,
    toolCtx: toolCtx || { agentKey: agent.key, chatId },
    onEvent: (ev) => {
      if (ev.type !== "delta") return;
      const full = ev.text;
      if (!st.previewSent) {
        // wait for a meaningful first fragment, then claim the stream surface
        if (full.trim().length < 30) return;
        st.previewSent = true;
        stopTyping();
        if (!st.draftTried) {
          st.draftTried = true;
          void tgCall(token, "sendMessageDraft", { chat_id: chatId, text: plainPreview(full, 1200) }, 8_000)
            .then((r) => {
              if (r.ok) st.draftMode = true;
              else void claimPlaceholder(full);
            })
            .catch(() => void claimPlaceholder(full));
          return;
        }
        void claimPlaceholder(full);
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

  async function claimPlaceholder(full: string) {
    try {
      const r = await tgCall(token, "sendMessage", {
        chat_id: chatId,
        text: plainPreview(full, 1200),
        disable_web_page_preview: true,
      });
      const id = (r.result as { message_id?: number } | undefined)?.message_id;
      if (r.ok && typeof id === "number") st.messageId = id;
    } catch {
      /* channel hiccup — final send still happens */
    }
  }

  if (!result.ok || !result.content) {
    const errText = `⚠ All brains failed to answer just now. Last error: ${
      result.fallbackChain.at(-1)?.error || result.error || "unknown"
    }`;
    return { text: errText, ok: false, error: result.error };
  }

  const reply = result.content;

  if (st.previewSent && st.messageId) {
    // finalize: swap the preview for the fully formatted version (chunk-aware)
    await sendFormatted(token, chatId, reply, st.messageId);
  } else {
    // stream never produced a preview (fast response) — send formatted now
    await sendFormatted(token, chatId, reply);
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
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string; first_name?: string; title?: string };
  text?: string;
  caption?: string;
  date: number;
  voice?: { file_id: string; duration?: number; mime_type?: string };
  audio?: { file_id: string; duration?: number; mime_type?: string; title?: string };
  photo?: TelegramPhotoSize[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
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

/** Transcribe an incoming Telegram voice/audio note via the built-in ASR. */
async function transcribeTelegramVoice(
  botToken: string,
  msg: TelegramMessage
): Promise<Intake | null> {
  const fileId = msg.voice?.file_id || msg.audio?.file_id;
  if (!fileId) return null;
  const bytes = await tgGetFileBytes(botToken, fileId);
  if (!bytes) return { text: "", note: "I couldn't download that voice note — please try again or type it." };
  try {
    const zai = await getZAI();
    const r = (await zai.audio.asr.create({ file_base64: bytes.toString("base64") })) as
      | { text?: string; result?: { text?: string } }
      | string;
    const text =
      typeof r === "string"
        ? r
        : r.text || r.result?.text || "";
    if (!text.trim()) {
      return { text: "", note: "I couldn't make out the audio — could you type it?" };
    }
    return { text: text.trim(), note: `[voice note from ${msg.from?.first_name || "user"}]` };
  } catch {
    return {
      text: "",
      note: "Voice transcription is unavailable on this deployment — type your message and I'll take it from there.",
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
  if (cmd === "/help") {
    await replyAndRecord(
      agent,
      chat.chatId,
      [
        `${agent.agentName} — your personal agent (Deep-init AI)`,
        "",
        "Just talk to me: ask questions, send tasks, paste text, forward links.",
        "🎤 Voice notes → I transcribe and answer. 📷 Photos → I analyze them.",
        "",
        "Tools I can run: live web search, page reading, image search & generation, voice notes (TTS), long-term memory, scheduled reminders. Long code arrives as files.",
        "",
        "Commands:",
        "/status — what I am and what's wired",
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
 * Processes one Telegram update against the gateway registry.
 * This is the single code path shared by webhook + poll bridge.
 */
export async function handleTelegramUpdate(
  update: TelegramUpdate,
  botToken: string
): Promise<UpdateOutcome> {
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

    const out = await streamReplyToChat(agent, chatId, messages, {
      agentKey: agent.key,
      chatId,
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
