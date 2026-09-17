/* ============================================================
 * Offline reflex brain — the demo brain's last-resort tier.
 *
 * WHY: the cloud demo tier (z-ai SDK) is unreachable from some
 * deployments — e.g. serverless lambdas whose egress can't reach
 * the model endpoint, or hosts without credentials. The product
 * promise is "the agent never goes mute", so when the SDK tier
 * fails we answer from this fully in-process engine.
 *
 * Zero network, zero keys, zero deps:
 *   - greetings / identity / help reflexes (EN + RU + HE)
 *   - time & date
 *   - safe arithmetic (whitelisted chars, no eval of user code)
 *   - honest offline notice for everything else
 * ============================================================ */

export interface ReflexReply {
  content: string;
  via: string;
}

const OFFLINE_NOTE = [
  "ℹ️ **Offline reflex mode** — the cloud demo brain isn't reachable from this deployment (no egress to the model endpoint). Init itself stays fully up: the Telegram gateway, tool execution, memory and pairing all keep running.",
  "",
  "For full LLM answers on this deployment, add your own provider key in the wizard (step 3) — OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, Ollama, anything OpenAI-compatible or Anthropic-native. Keys are BYOK: they live in your browser and are only used in-flight.",
].join("\n");

function reflexGreeting(agentName: string): string {
  return [
    `Hey — ${agentName} here. 👋 I'm your 24×7 personal agent: you talk to me on Telegram or right here in the console, and I run tasks for you around the clock.`,
    "",
    "Right now I'm answering from my **offline reflex tier** (the configured cloud brains aren't reachable from this deployment), so keep it simple: greetings, math, time/date, status. Wire a provider key in the wizard and I'll answer anything at full strength.",
  ].join("\n");
}

function reflexIdentity(agentName: string): string {
  return [
    `I'm **${agentName}** — a Deep-init personal agent (v1.0.0 · agent kernel).`,
    "",
    "• **Always on** — Telegram gateway with webhook push or poll bridge, web console 24/7",
    "• **Any brain** — bring your own providers (OpenAI-compatible / Anthropic-native) with automatic top-down fallback, plus optional Hermes / Moltis cognition packs",
    "• **Real tools** — web search, page reading, code files, voice, images, reminders, SSH machines via pair-tunnel",
    "• **Self-skilling** — writes new skills when a task needs one",
    "",
    OFFLINE_NOTE,
  ].join("\n");
}

function reflexHelp(): string {
  return [
    "**What I can do right now (offline reflex tier):**",
    "",
    "• arithmetic — try `17.5% of 2_384 * 12` or `(144/12)^2 + 7`",
    "• `time` / `date` — current UTC time",
    "• `status` — what tier is answering and why",
    "• greetings & identity",
    "",
    "**With a provider wired (wizard step 3):** everything — research briefings, code, files sent as Telegram documents, voice, vision, reminders, cron jobs, SSH ops on your linked machines.",
    "",
    OFFLINE_NOTE,
  ].join("\n");
}

/** Strict whitelist arithmetic: digits, operators, brackets only. */
function safeArithmetic(raw: string): number | null {
  let expr = raw.toLowerCase().replace(/[_,\s]/g, "");
  // "17.5% of 2384*12" → "(17.5/100)*(2384*12)"
  expr = expr.replace(/(\d+(?:\.\d+)?)%of([\d.()+\-*/^]+)/g, "($1/100)*($2)");
  expr = expr.replace(/%/g, "/100");
  if (!expr || !/\d/.test(expr)) return null;
  if (!/^[\d.()+\-*/^]+$/.test(expr)) return null; // whitelist — letters etc. rejected
  if (!/[+\-*/^]/.test(expr)) return null; // must be an actual operation
  const js = expr.replace(/\^/g, "**");
  try {
    const val = Function(`"use strict";return (${js})`)() as unknown;
    if (typeof val !== "number" || !Number.isFinite(val)) return null;
    return val;
  } catch {
    return null;
  }
}

function fmtNum(n: number): string {
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
}

export function reflexReply(userText: string, agentName = "Init"): ReflexReply {
  const text = (userText || "").trim();
  const low = text.toLowerCase();
  const via = "Deep-init demo brain (offline reflex)";

  if (!text) {
    return {
      via,
      content: "I'm here — send a message and I'll get to work. (offline reflex tier active)",
    };
  }

  /* greetings — EN / RU / HE */
  if (
    /^(hi|hiya|hello|hey|yo|sup|good\s(morning|afternoon|evening)|howdy)\b/i.test(low) ||
    /^(привет|здравствуй|доброе утро|добрый день|добрый вечер)\b/i.test(low) ||
    /^(שלום|היי|בוקר טוב|ערב טוב)/i.test(low) ||
    /^\/start$/i.test(low)
  ) {
    return { via, content: reflexGreeting(agentName) };
  }

  /* identity / capabilities */
  if (
    /(who are you|what are you|your name|what can you do|capabilit|about you|introduce)/i.test(low) ||
    /(кто ты|что ты умеешь|как тебя зовут)/i.test(low) ||
    /(מי אתה|מה אתה יודע|מה אתה עושה)/i.test(low)
  ) {
    return { via, content: reflexIdentity(agentName) };
  }

  /* help / status */
  if (/^(help|commands|menu|status|статус|помощь)\b/i.test(low) || /^\/(help|status)$/i.test(low)) {
    if (/^status$|^\/status$|^статус$/i.test(low)) {
      return {
        via,
        content: [
          "**Status**",
          "• answering tier: offline reflex (cloud demo brain unreachable from this deployment)",
          "• telegram gateway: running (webhook / poll bridge per origin)",
          "• tools: armed (web_search, web_fetch, calc — executed server-side)",
          "• memory: persistent",
          "",
          OFFLINE_NOTE,
        ].join("\n"),
      };
    }
    return { via, content: reflexHelp() };
  }

  /* time / date */
  if (/^(time|date|what time|what.s the time|today|который час|дата|сегодня)\b/i.test(low)) {
    const now = new Date();
    return {
      via,
      content: [
        `🕒 **${now.toUTCString()}** (UTC)`,
        "",
        "Local timezone handling comes with a full cloud brain — this is the offline reflex tier.",
      ].join("\n"),
    };
  }

  /* arithmetic */
  const math = safeArithmetic(text);
  if (math !== null) {
    return {
      via,
      content: `🧮 \`${text.replace(/[_\s]/g, "")}\` = **${fmtNum(math)}**`,
    };
  }
  if (/(calculate|compute|what is|сколько|сколько будет)/i.test(low)) {
    const inner = text.replace(/^(what is|calculate|compute|сколько будет)\s*/i, "");
    const innerMath = safeArithmetic(inner);
    if (innerMath !== null) {
      return {
        via,
        content: `🧮 \`${inner.replace(/[_\s]/g, "")}\` = **${fmtNum(innerMath)}**`,
      };
    }
  }

  /* honest fallback — never fabricate an LLM answer */
  return {
    via,
    content: [
      `I heard you: “${text.slice(0, 220)}${text.length > 220 ? "…" : ""}”`,
      "",
      "Answering that at full strength needs a cloud brain, which isn't reachable from this deployment — and I don't fake answers.",
      "",
      OFFLINE_NOTE,
    ].join("\n"),
  };
}
