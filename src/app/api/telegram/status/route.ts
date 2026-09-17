import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agent-registry";
import { gatewayStatus } from "@/lib/telegram";
import type { GatewayStatus } from "@/lib/types";

/**
 * Gateway status for the channels dashboard: bound chats, which pairing
 * tokens are active, and the latest replies the agent sent on Telegram.
 *
 * Body: { key: "<sessionKey>" }
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
    const payload: GatewayStatus = { registered: false, chats: [], recentReplies: [], boundTokens: [] };
    return NextResponse.json({ ok: true, ...payload });
  }

  const { chats, boundTokens } = gatewayStatus(agent);
  const payload: GatewayStatus = {
    registered: true,
    botUsername: agent.botUsername,
    chats,
    boundTokens,
    recentReplies: agent.recentReplies.slice(0, 6),
  };
  return NextResponse.json({ ok: true, ...payload });
}
