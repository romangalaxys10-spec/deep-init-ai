import { NextRequest, NextResponse } from "next/server";
import { relay, machineStatus } from "@/lib/relay";
import { badRequest } from "@/lib/ssh";

export const maxDuration = 30;
export const runtime = "nodejs";

/** Dashboard → relay: command history for a machine. */
export async function POST(req: NextRequest) {
  let body: { id?: string; token?: string };
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
  return NextResponse.json({
    ok: true,
    history: relay.history(id),
    status: machineStatus(entry.lastSeen),
    hostname: entry.hostname,
    uptime: entry.uptime,
    sysinfo: entry.sysinfo,
    lastSeen: entry.lastSeen,
  });
}
