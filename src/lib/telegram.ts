import {
  agentsForBot,
  bindChat,
  findBoundAgent,
  findByPairingToken,
  pushThread,
  recordReply,
  refreshRegistry,
  touchAgent,
  type ChatMsg,
  type RegisteredAgent,
  type TokenMatch,
} from "./agent-registry";
import { runAgentChainStreaming } from "./brain";
import type { GatewayChat } from "./types";
import {
  htmlToPlain,
  markdownToTelegramHTML,
  plainPreview,
  splitTelegramHtml,
} from "./telegram-format";

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

const EDIT_MIN_INTERVAL_MS = 1_600; // Telegram rate-friendliness
const EDIT_MIN_NEW_CHARS = 48;

/**
 * Send (or edit-in-place) a markdown-ish reply as Telegram HTML with
 * code-block rendering, fence-aware chunking and a plain-text fallback
 * when Telegram rejects the entities — formatting is never silently lost.
 */
export async function sendFormatted(
  token: string,
  chatId: number,
  md: string,
  editMessageId?: number
) {
  const html = markdownToTelegramHTML(md);
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
}

interface StreamReplyResult {
  text: string;
  ok: boolean;
  error?: string;
}

/**
 * OpenClaw-style "preview streaming": a placeholder message is sent as soon
 * as the first tokens arrive, then editMessageText appends while the model
 * writes; the final edit swaps in fully formatted HTML (code blocks etc.).
 * A typing action is renewed every ~4s until the stream starts.
 */
async function streamReplyToChat(
  agent: RegisteredAgent,
  chatId: number,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<StreamReplyResult> {
  const token = agent.botToken;

  const typing: ReturnType<typeof setInterval> | null = setInterval(() => {
    void tgSendChatAction(token, chatId);
  }, 4_200);
  const stopTyping = () => {
    if (typing) clearInterval(typing);
  };

  const st = { previewSent: false, messageId: 0, lastEditAt: 0, lastLen: 0 };

  const result = await runAgentChainStreaming({
    providers: agent.providers,
    messages,
    allowDemoBrain: agent.allowDemoBrain,
    onEvent: (ev) => {
      if (ev.type !== "delta") return;
      const full = ev.text;
      if (!st.previewSent) {
        // wait for a meaningful first fragment, then claim the message slot
        if (full.trim().length < 30) return;
        st.previewSent = true;
        stopTyping();
        void tgCall(token, "sendMessage", {
          chat_id: chatId,
          text: plainPreview(full, 1200),
          disable_web_page_preview: true,
        })
          .then((r) => {
            const id = (r.result as { message_id?: number } | undefined)?.message_id;
            if (r.ok && typeof id === "number") st.messageId = id;
          })
          .catch(() => {});
        return;
      }
      const now = Date.now();
      if (
        st.messageId &&
        now - st.lastEditAt >= EDIT_MIN_INTERVAL_MS &&
        full.length - st.lastLen >= EDIT_MIN_NEW_CHARS
      ) {
        st.lastEditAt = now;
        st.lastLen = full.length;
        void tgCall(token, "editMessageText", {
          chat_id: chatId,
          message_id: st.messageId,
          text: plainPreview(full) + " ▌",
          disable_web_page_preview: true,
        }).catch(() => {});
      }
    },
  });
  stopTyping();

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

/* ---------------- update handling ---------------- */

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string; first_name?: string; title?: string };
  text?: string;
  date: number;
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
  if (mode === "owner") {
    return `\n\n[Context: you are chatting with ${agent.ownerName} — your owner and operator, via Telegram. This is the main shared thread.]`;
  }
  if (mode === "shared") {
    return `\n\n[Context: you are chatting with ${userName} — a whitelisted user invited by ${agent.ownerName}. You share memory and context with ${agent.ownerName}'s main thread.]`;
  }
  return `\n\n[Context: you are chatting with ${userName} — a whitelisted user invited by ${agent.ownerName}. This conversation is ISOLATED: keep it self-contained and private to ${userName}.]`;
}

async function replyAndRecord(agent: RegisteredAgent, chatId: number, text: string) {
  await tgSendMessage(agent.botToken, chatId, text);
  recordReply(agent, chatId, text);
  touchAgent(agent);
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
  if (!msg?.text) return { handled: "ignored" };

  const chatId = msg.chat.id;
  const firstName =
    msg.from?.first_name || msg.from?.username || msg.chat.first_name || "friend";
  const text = msg.text.trim();

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

  /* 4) chat message — streamed live to the chat (preview streaming) */
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

    const out = await streamReplyToChat(agent, chatId, messages);

    pushThread(thread, { role: "assistant", content: out.text });
    recordReply(agent, chatId, out.text);
    touchAgent(agent);
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
