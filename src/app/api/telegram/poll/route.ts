import { NextRequest, NextResponse } from "next/server";
import { getAgent, touchAgent } from "@/lib/agent-registry";
import { handleTelegramUpdate, tgGetUpdates, type TelegramUpdate } from "@/lib/telegram";

export const maxDuration = 60;

/**
 * Browser-driven poll bridge (localhost / when no webhook is set).
 * The portal pings this route every few seconds while it is open; we pull
 * new updates from Telegram and run them through the same handler as the
 * webhook. This is what makes the bot answer even in local dev.
 *
 * Body: { key: "<sessionKey from /api/pair/telegram>" }
 */
export async function POST(req: NextRequest) {
  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const agent = getAgent(body.key);
  if (!agent) {
    return NextResponse.json(
      { ok: false, error: "Gateway session not registered — press Resync in the channels tab." },
      { status: 404 }
    );
  }

  try {
    const res = await tgGetUpdates(agent.botToken, agent.offset ?? 0);
    if (!res.ok || !res.result) {
      const desc = res.description || "getUpdates failed";
      const conflict = /conflict|webhook/i.test(desc);
      return NextResponse.json(
        {
          ok: false,
          error: conflict
            ? "A webhook is active for this bot — polling is disabled. Use the webhook gateway."
            : desc,
        },
        { status: 502 }
      );
    }

    let processed = 0;
    const replies: { chatId: number; preview: string }[] = [];
    let maxId = agent.offset ?? 0;

    for (const update of res.result) {
      maxId = Math.max(maxId, update.update_id + 1);
      try {
        const outcome = await handleTelegramUpdate(update as TelegramUpdate, agent.botToken);
        processed += 1;
        if (outcome.replyPreview) {
          replies.push({ chatId: update.message?.chat.id ?? 0, preview: outcome.replyPreview });
        }
      } catch (e) {
        console.error("[telegram:poll]", e);
      }
    }

    agent.offset = maxId;
    agent.lastSeen = Date.now();
    touchAgent(agent);

    return NextResponse.json({ ok: true, processed, replies });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Telegram unreachable: ${msg}` }, { status: 502 });
  }
}
