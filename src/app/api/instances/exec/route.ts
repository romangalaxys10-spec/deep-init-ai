import { NextRequest, NextResponse } from "next/server";
import { readCreds, withSSH, runCommand, badRequest } from "@/lib/ssh";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const creds = readCreds(body);
  if (!creds) return badRequest("host, username and credentials are required");

  const { command } = body as { command?: string };
  const cmd = (command || "").trim();
  if (!cmd) return badRequest("command is required");

  try {
    const r = await withSSH(creds, (conn) => runCommand(conn, cmd));
    return NextResponse.json({
      ok: r.code === 0 || (!!r.stdout && r.code === null),
      exitCode: r.code,
      stdout: r.stdout.slice(0, 8000),
      stderr: r.stderr.slice(0, 4000),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
