import { NextRequest, NextResponse } from "next/server";
import { runAgentChain, runAgentChainStreaming } from "@/lib/brain";
import type { ChatRequest } from "@/lib/types";
import { appendDirective, languageDirective, parseLangTag } from "@/lib/lang-detect";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: ChatRequest & { stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  if (!messages.length) {
    return NextResponse.json({ error: "messages[] is required" }, { status: 400 });
  }

  /* Language Mirror — the console tags mic-originated messages with the
   * transcript's language. Pin the reply language for THIS turn by appending
   * the directive to the system prompt (same helper as the Telegram gateway). */
  if (parseLangTag(body.voiceLang)) {
    if (messages[0]?.role === "system") {
      messages[0] = { ...messages[0], content: appendDirective(messages[0].content, body.voiceLang, true) };
    } else {
      messages.unshift({ role: "system", content: languageDirective(parseLangTag(body.voiceLang)!) });
    }
  }

  const providers = Array.isArray(body.providers) ? body.providers : [];

  /* ---- streaming mode: NDJSON lines, one JSON object per line ----
     {type:"provider_start", label, model}
     {type:"delta", text}           ← accumulated full text so far
     {type:"done", ok, content, via, latencyMs, fallbackChain, error} */
  if (body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch {
            /* client disconnected */
          }
        };
        const result = await runAgentChainStreaming({
          providers,
          messages,
          allowDemoBrain: body.allowDemoBrain,
          brains: body.brains,
          onEvent: (ev) => {
            if (ev.type === "provider_start") {
              send({ type: "provider_start", label: ev.label, model: ev.model });
            } else {
              send({ type: "delta", text: ev.text });
            }
          },
        });
        send({
          type: "done",
          ok: result.ok,
          content: result.content,
          via: result.via,
          latencyMs: result.latencyMs,
          fallbackChain: result.fallbackChain,
          error: result.error,
        });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  /* ---- classic JSON mode ---- */
  const result = await runAgentChain({ providers, messages, allowDemoBrain: body.allowDemoBrain, brains: body.brains });

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
