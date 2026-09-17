import { NextRequest, NextResponse, after } from "next/server";
import { markUpdateSeen, persistRegistry, refreshRegistry } from "@/lib/agent-registry";
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
 * Acknowledges INSTANTLY (Telegram re-delivers when it doesn't get a
 * timely 200 — one of the root causes of duplicate replies) and runs
 * the handler in the request's background window via after(). An
 * update-id ledger drops any redelivered/duplicated update.
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
  if (!update || typeof update.update_id !== "number") {
    return NextResponse.json({ ok: true, skipped: "invalid update" });
  }

  if (!markUpdateSeen(botToken, update.update_id)) {
    return NextResponse.json({ ok: true, skipped: "duplicate update" });
  }

  after(async () => {
    try {
      await refreshRegistry();
      await handleTelegramUpdate(update, botToken);
      await persistRegistry();
    } catch (e) {
      console.error("[telegram:webhook]", e);
    }
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "deep-init telegram gateway" });
}
