import { NextRequest, NextResponse } from "next/server";
import {
  allAgents,
  dueReminders,
  markRemindersDone,
  persistRegistry,
  refreshRegistry,
  touchAgent,
} from "@/lib/agent-registry";
import { sendFormatted } from "@/lib/telegram";

export const maxDuration = 60;

/**
 * Reminder flusher — Vercel Cron hits this endpoint (vercel.json).
 * ALSO runs lazily on every Telegram update (flushDueReminders in the
 * gateway), so reminders fire on activity even where cron granularity
 * is limited. Auth: when CRON_SECRET is set, manual calls must pass
 * ?key=<CRON_SECRET> or a Bearer token; Vercel Cron requests carry the
 * x-vercel-cron header and are accepted.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const key =
      req.nextUrl.searchParams.get("key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";
    const isVercelCron = req.headers.get("x-vercel-cron") !== null;
    if (key !== secret && !isVercelCron) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  await refreshRegistry({ force: true });

  const flushed: { agent: string; chatId: number; text: string }[] = [];
  for (const agent of allAgents()) {
    const due = dueReminders(agent);
    if (!due.length) continue;
    for (const r of due) {
      await sendFormatted(agent.botToken, r.chatId, `⏰ *Reminder*: ${r.text}`).catch(
        () => undefined
      );
      flushed.push({ agent: agent.agentName, chatId: r.chatId, text: r.text.slice(0, 80) });
    }
    markRemindersDone(
      agent,
      due.map((r) => r.id)
    );
    touchAgent(agent);
  }
  await persistRegistry();

  return NextResponse.json({ ok: true, flushed: flushed.length, items: flushed });
}
