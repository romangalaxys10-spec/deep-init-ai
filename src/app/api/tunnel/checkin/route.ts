import { NextRequest, NextResponse } from "next/server";
import { relay, machineStatus } from "@/lib/relay";
import { badRequest } from "@/lib/ssh";

export const maxDuration = 30;
export const runtime = "nodejs";

/**
 * Called by the pair-tunnel agent script on the user's machine.
 * Records the heartbeat and returns any queued commands (one at a time).
 */
export async function POST(req: NextRequest) {
  let body: {
    id?: string;
    token?: string;
    hostname?: string;
    os?: string;
    uptime?: string;
    sysinfo?: string;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { id, token } = body;
  if (!id || !token || !relay.verify(id, token)) {
    return NextResponse.json({ error: "unknown machine or bad token" }, { status: 401 });
  }

  const entry = relay.get(id)!;
  entry.lastSeen = new Date().toISOString();
  if (body.hostname) entry.hostname = String(body.hostname).slice(0, 120);
  if (body.uptime) entry.uptime = String(body.uptime).slice(0, 160);
  if (body.sysinfo) entry.sysinfo = String(body.sysinfo).slice(0, 160);

  // hand out one queued command per check-in
  const next = entry.commands.find((c) => c.status === "queued");
  if (next) {
    return NextResponse.json({
      ok: true,
      commandId: next.id,
      command: next.command,
      status: machineStatus(entry.lastSeen),
    });
  }

  return NextResponse.json({ ok: true, status: machineStatus(entry.lastSeen) });
}
