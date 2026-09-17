import { NextRequest, NextResponse } from "next/server";
import { relay, machineStatus } from "@/lib/relay";
import { badRequest } from "@/lib/ssh";

export const maxDuration = 30;
export const runtime = "nodejs";

/** Dashboard → relay: queue a command for a paired machine. */
export async function POST(req: NextRequest) {
  let body: { id?: string; token?: string; command?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { id, token, command } = body;
  if (!id || !token || !relay.verify(id, token)) {
    return NextResponse.json({ error: "unknown machine or bad token" }, { status: 401 });
  }
  const cmd = (command || "").trim().slice(0, 2000);
  if (!cmd) return badRequest("command is required");

  try {
    const queued = relay.enqueue(id, cmd);
    return NextResponse.json({ ok: true, commandId: queued.id, status: machineStatus(relay.get(id)!.lastSeen) });
  } catch {
    return NextResponse.json({ error: "unknown machine" }, { status: 404 });
  }
}

/** Dashboard → relay: poll a command's result. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const commandId = url.searchParams.get("commandId");
  if (!id || !token || !relay.verify(id, token)) {
    return NextResponse.json({ error: "unknown machine or bad token" }, { status: 401 });
  }
  const entry = relay.get(id)!;
  if (commandId) {
    const cmd = entry.commands.find((c) => c.id === commandId);
    return NextResponse.json({ ok: true, command: cmd || null, status: machineStatus(entry.lastSeen) });
  }
  return NextResponse.json({ ok: true, history: relay.history(id), status: machineStatus(entry.lastSeen) });
}
