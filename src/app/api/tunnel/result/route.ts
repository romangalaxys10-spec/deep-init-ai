import { NextRequest, NextResponse } from "next/server";
import { relay } from "@/lib/relay";
import { badRequest } from "@/lib/ssh";

export const maxDuration = 30;
export const runtime = "nodejs";

/** Machine → relay: post a command's output back. */
export async function POST(req: NextRequest) {
  let body: { id?: string; token?: string; commandId?: string; result?: string; failed?: boolean };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { id, token, commandId, result, failed } = body;
  if (!id || !token || !relay.verify(id, token)) {
    return NextResponse.json({ error: "unknown machine or bad token" }, { status: 401 });
  }
  if (!commandId) return badRequest("commandId is required");

  relay.complete(
    id,
    commandId,
    String(result ?? "").slice(0, 8000),
    !!failed
  );
  return NextResponse.json({ ok: true });
}
