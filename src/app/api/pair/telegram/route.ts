import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * Verifies a Telegram bot token against the real Telegram Bot API (getMe).
 * This is what the Deep-init gateway will use to attach the bot to the agent.
 */
export async function POST(req: NextRequest) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const token = (body.token || "").trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return NextResponse.json(
      { ok: false, error: "That doesn't look like a Telegram bot token. Get one from @BotFather — format: 123456789:AA... ." },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { id: number; username?: string; first_name?: string };
      description?: string;
    };

    if (!data.ok || !data.result) {
      return NextResponse.json(
        { ok: false, error: data.description || "Telegram rejected this token." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      bot: {
        id: data.result.id,
        username: data.result.username,
        firstName: data.result.first_name,
      },
      message: `Bot @${data.result.username} verified. Deep-init gateway will poll updates for this bot.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `Could not reach api.telegram.org: ${msg}` },
      { status: 502 }
    );
  }
}
