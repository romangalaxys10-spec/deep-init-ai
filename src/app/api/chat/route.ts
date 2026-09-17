import { NextRequest, NextResponse } from "next/server";
import { runAgentChain } from "@/lib/brain";
import type { ChatRequest } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  if (!messages.length) {
    return NextResponse.json({ error: "messages[] is required" }, { status: 400 });
  }

  const result = await runAgentChain({
    providers: Array.isArray(body.providers) ? body.providers : [],
    messages,
    allowDemoBrain: body.allowDemoBrain,
  });

  if (result.ok && result.content) {
    return NextResponse.json({
      content: result.content,
      via: result.via,
      latencyMs: result.latencyMs,
      fallbackChain: result.fallbackChain,
    });
  }

  return NextResponse.json(
    { error: result.error || "All providers failed", fallbackChain: result.fallbackChain },
    { status: 502 }
  );
}
