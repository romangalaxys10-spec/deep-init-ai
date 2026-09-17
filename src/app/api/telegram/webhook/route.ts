import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/telegram";
import { BUILTIN_BOT_TOKEN } from "@/lib/telegram";

export const maxDuration = 60;

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;

function botTokenFromRequest(req: NextRequest): string | null {
  const t = req.nextUrl.searchParams.get("t") || "";
  if (t === "builtin") return BUILTIN_BOT_TOKEN;
  return TOKEN_RE.test(t) ? t : null;
}

/**
 * Telegram webhook receiver.
 * URL: /api/telegram/webhook?t=<botToken>   (t=builtin for the shared bot)
 *
 * Looks up the agent runtime bound to this bot (via chat bindings or a
 * pairing token in the message) and answers through the provider chain.
 * Always returns 200 so Telegram doesn't retry-loop.
 */
export async function POST(req: NextRequest) {
  const botToken = botTokenFromRequest(req);
  if (!botToken) {
    return NextResponse.json({ ok: true, skipped: "unknown bot token" });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid update" });
  }

  try {
    const outcome = await handleTelegramUpdate(update, botToken);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    console.error("[telegram:webhook]", e);
    return NextResponse.json({ ok: true, error: "handler failure" });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "deep-init telegram gateway" });
}
