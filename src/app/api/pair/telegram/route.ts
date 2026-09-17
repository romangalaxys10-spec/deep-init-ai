import { NextRequest, NextResponse } from "next/server";
import { registerAgent } from "@/lib/agent-registry";
import { BUILTIN_BOT_TOKEN, tgDeleteWebhook, tgGetMe, tgSetWebhook } from "@/lib/telegram";
import type { ChatRequest } from "@/lib/types";

export const maxDuration = 30;

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;

interface PairConfig {
  agentName?: string;
  ownerName?: string;
  ownerToken?: string;
  systemPrompt?: string;
  providers?: ChatRequest["providers"];
  allowDemoBrain?: boolean;
  whitelist?: { token: string; name: string; mode: "shared" | "isolated" }[];
}

function isLocalHost(host: string): boolean {
  return (
    /^(localhost|127\.|0\.0\.0\.0|\[::1?\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.endsWith(".local")
  );
}

/**
 * Pairs a Telegram bot with an agent runtime.
 *
 * mode "builtin" → use the Deep-init built-in bot (@init_smart_bot)
 * mode "own"     → pair the user's own @BotFather bot (token verified live)
 *
 * When the portal runs on a public origin we register a Telegram webhook;
 * on localhost we clear the webhook so the browser-driven poll bridge can
 * fetch updates via getUpdates instead.
 */
export async function POST(req: NextRequest) {
  let body: { mode?: "builtin" | "own"; token?: string; config?: PairConfig };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "own" ? "own" : "builtin";
  const cfg = body.config || {};

  if (mode === "own") {
    const token = (body.token || "").trim();
    if (!TOKEN_RE.test(token)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "That doesn't look like a Telegram bot token. Get one from @BotFather — format: 123456789:AA... .",
        },
        { status: 400 }
      );
    }
    body.token = token;
  }

  const botToken = mode === "own" ? (body.token as string) : BUILTIN_BOT_TOKEN;

  /* live-verify the bot identity with Telegram */
  try {
    const me = await tgGetMe(botToken);
    if (!me.ok || !me.result) {
      return NextResponse.json(
        { ok: false, error: me.description || "Telegram rejected this bot token." },
        { status: 400 }
      );
    }

    const botUsername = me.result.username || (mode === "builtin" ? "init_smart_bot" : "bot");

    /* register the agent runtime so the gateway can answer messages */
    let sessionKey: string | undefined;
    if (cfg.ownerToken) {
      sessionKey =
        mode === "own" ? `own:${botToken}` : `builtin:${(cfg.ownerToken || "").toUpperCase()}`;
      registerAgent({
        key: sessionKey,
        botToken,
        botUsername,
        builtIn: mode === "builtin",
        agentName: cfg.agentName || "Init",
        ownerName: cfg.ownerName || "the operator",
        ownerToken: (cfg.ownerToken || "").toUpperCase(),
        systemPrompt: cfg.systemPrompt || "You are a helpful personal autonomous agent.",
        providers: Array.isArray(cfg.providers) ? cfg.providers : [],
        allowDemoBrain: cfg.allowDemoBrain !== false,
        whitelist: Array.isArray(cfg.whitelist) ? cfg.whitelist : [],
      });
    }

    /* webhook on public origins, poll bridge on localhost */
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      host = "";
    }

    let gatewayMode: "webhook" | "poll" = "poll";
    let warning: string | undefined;

    if (host && !isLocalHost(host)) {
      const hookUrl = `${origin}/api/telegram/webhook?t=${encodeURIComponent(botToken)}`;
      const hook = await tgSetWebhook(botToken, hookUrl);
      if (hook.ok) {
        gatewayMode = "webhook";
      } else {
        warning = `Webhook registration failed (${hook.description || "unknown"}) — falling back to the poll bridge.`;
      }
    } else {
      await tgDeleteWebhook(botToken).catch(() => undefined);
      warning =
        "Local origin — the gateway runs in poll-bridge mode: keep the portal open and the bridge will fetch updates.";
    }

    return NextResponse.json({
      ok: true,
      bot: { id: me.result.id, username: botUsername, firstName: me.result.first_name },
      builtIn: mode === "builtin",
      sessionKey,
      gatewayMode,
      warning,
      message: `Bot @${botUsername} verified and wired to the Deep-init gateway.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `Could not reach api.telegram.org: ${msg}` },
      { status: 502 }
    );
  }
}
