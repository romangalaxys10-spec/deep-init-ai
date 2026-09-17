import { NextResponse } from "next/server";
import { relay, machineStatus } from "@/lib/relay";

export const maxDuration = 30;
export const runtime = "nodejs";

/** Dashboard → relay: list all registered tunnel machines with live status. */
export async function GET() {
  const machines = relay.all().map((e) => ({
    id: e.id,
    token: e.token,
    name: e.name,
    os: e.os,
    hostname: e.hostname,
    uptime: e.uptime,
    sysinfo: e.sysinfo,
    lastSeen: e.lastSeen,
    status: machineStatus(e.lastSeen),
    pending: e.commands.filter((c) => c.status === "queued").length,
  }));
  return NextResponse.json({ ok: true, machines });
}
