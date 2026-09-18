import { NextRequest, NextResponse } from "next/server";
import {
  findAgentByOwner,
  persistRegistry,
  refreshRegistry,
  touchAgent,
  type RegisteredAgent,
} from "@/lib/agent-registry";
import { getPreset } from "@/lib/presets";
import { normalizeBrainConfig } from "@/lib/brains";
import { isKnownPersonaVoice } from "@/lib/voice-personas";

export const maxDuration = 30;

/** Provider shape mirrors the wizard's AIProvider (BYOK — stored on the
 *  gateway agent so Telegram replies use the same brains as the console). */
function sanitizeProviders(raw: unknown): RegisteredAgent["providers"] | null {
  if (!Array.isArray(raw)) return null;
  const out = (raw as Record<string, unknown>[])
    .filter((p) => p && typeof p === "object" && typeof p.baseUrl === "string" && typeof p.model === "string" && p.baseUrl.trim() && p.model.trim())
    .slice(0, 10)
    .map((p) => ({
      label: typeof p.label === "string" ? p.label : undefined,
      baseUrl: String(p.baseUrl).trim(),
      apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
      model: String(p.model).trim(),
      compat: p.compat === "anthropic" ? ("anthropic" as const) : ("openai" as const),
    }));
  return out as RegisteredAgent["providers"];
}

/**
 * Lightweight agent config updates from the portal — preset activation,
 * system prompt tweaks, voice persona, PROVIDER CHANGES — without
 * re-pairing the bot.
 * Body: { ownerToken, presetId?: string | null, systemPrompt?: string,
 *         brains?: { hermes?: boolean, moltis?: boolean } | null,
 *         voiceId?: string | null, voiceRate?: number, voicePitch?: number,
 *         providers?: AIProvider[] }
 */
export async function POST(req: NextRequest) {
  let body: {
    ownerToken?: string;
    presetId?: string | null;
    systemPrompt?: string;
    brains?: { hermes?: boolean; moltis?: boolean } | null;
    voiceId?: string | null;
    voiceRate?: number;
    voicePitch?: number;
    providers?: unknown;
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

  /* Voice Persona Passport — the web picker is the source of truth for how
     the agent sounds everywhere, Telegram voice notes included. */
  if (body.voiceId !== undefined) {
    agent.voiceId = body.voiceId && isKnownPersonaVoice(body.voiceId) ? body.voiceId : undefined;
  }
  if (body.voiceRate !== undefined && Number.isFinite(body.voiceRate)) {
    agent.voiceRate = Math.max(-50, Math.min(50, Math.round(body.voiceRate)));
  }
  if (body.voicePitch !== undefined && Number.isFinite(body.voicePitch)) {
    agent.voicePitch = Math.max(-50, Math.min(50, Math.round(body.voicePitch)));
  }

  /* Provider Passport — provider changes made in the portal (add / edit /
     remove / reorder) reach the Telegram gateway WITHOUT re-pairing.
     Before this, the gateway kept the pairing-time snapshot forever, so a
     newly added custom provider was silently ignored and the bot kept
     answering from the demo brain telling the user to add a key. */
  if (body.providers !== undefined) {
    const providers = sanitizeProviders(body.providers);
    if (providers === null) {
      return NextResponse.json({ ok: false, error: "providers must be an array" }, { status: 400 });
    }
    agent.providers = providers;
  }

  touchAgent(agent);
  await persistRegistry();

  return NextResponse.json({
    ok: true,
    presetId: agent.presetId ?? null,
    brains: normalizeBrainConfig(agent.brains),
    systemPrompt: agent.systemPrompt,
    agentName: agent.agentName,
    voiceId: agent.voiceId ?? null,
    voiceRate: agent.voiceRate ?? 0,
    voicePitch: agent.voicePitch ?? 0,
    providers: agent.providers,
  });
}
