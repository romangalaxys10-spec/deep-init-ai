import { NextRequest, NextResponse } from "next/server";
import {
  findAgentByOwner,
  persistRegistry,
  refreshRegistry,
  touchAgent,
} from "@/lib/agent-registry";
import { getPreset } from "@/lib/presets";
import { normalizeBrainConfig } from "@/lib/brains";

export const maxDuration = 30;

/**
 * Lightweight agent config updates from the portal — preset activation,
 * system prompt tweaks — without re-pairing the bot.
 * Body: { ownerToken, presetId?: string | null, systemPrompt?: string,
 *         brains?: { hermes?: boolean, moltis?: boolean } }
 */
export async function POST(req: NextRequest) {
  let body: {
    ownerToken?: string;
    presetId?: string | null;
    systemPrompt?: string;
    brains?: { hermes?: boolean; moltis?: boolean } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const ownerToken = (body.ownerToken || "").trim();
  if (!ownerToken) {
    return NextResponse.json({ ok: false, error: "ownerToken is required" }, { status: 400 });
  }

  await refreshRegistry({ force: true });
  const agent = findAgentByOwner(ownerToken);
  if (!agent) {
    return NextResponse.json(
      { ok: false, error: "No paired agent for this token — pair a channel first." },
      { status: 404 }
    );
  }

  if (body.presetId !== undefined) {
    if (body.presetId === null || body.presetId === "") {
      agent.presetId = undefined;
    } else if (getPreset(body.presetId)) {
      agent.presetId = body.presetId;
    } else {
      return NextResponse.json({ ok: false, error: "Unknown presetId" }, { status: 400 });
    }
  }

  if (body.brains !== undefined) {
    // toggle packs: null clears both; partial objects only flip given keys
    agent.brains =
      body.brains === null
        ? { hermes: false, moltis: false }
        : normalizeBrainConfig({ ...normalizeBrainConfig(agent.brains), ...body.brains });
  }

  if (typeof body.systemPrompt === "string" && body.systemPrompt.trim().length > 20) {
    agent.systemPrompt = body.systemPrompt.trim().slice(0, 8000);
  }

  touchAgent(agent);
  await persistRegistry();

  return NextResponse.json({
    ok: true,
    presetId: agent.presetId ?? null,
    brains: normalizeBrainConfig(agent.brains),
    systemPrompt: agent.systemPrompt,
    agentName: agent.agentName,
  });
}
