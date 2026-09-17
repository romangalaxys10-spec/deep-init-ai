import type { ChatRequest, FallbackStep } from "./types";

export const PROVIDER_TIMEOUT_MS = 45_000;

type Msg = ChatRequest["messages"][number];

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

interface CallResult {
  ok: boolean;
  content?: string;
  error?: string;
  latencyMs: number;
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Msg[]
): Promise<CallResult> {
  const started = Date.now();
  try {
    const url = `${normalizeBase(baseUrl)}/chat/completions`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}`, latencyMs };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "Invalid JSON response from provider", latencyMs };
    }
    const d = data as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (d.error) return { ok: false, error: d.error.message || "Provider error", latencyMs };
    const content = d.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.length) {
      return { ok: false, error: "Empty completion", latencyMs };
    }
    return { ok: true, content, latencyMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort/i.test(msg) ? `Timed out after ${PROVIDER_TIMEOUT_MS / 1000}s` : msg,
      latencyMs: Date.now() - started,
    };
  }
}

async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Msg[]
): Promise<CallResult> {
  const started = Date.now();
  try {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const url = `${normalizeBase(baseUrl)}/v1/messages`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: rest,
      }),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}`, latencyMs };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "Invalid JSON response from provider", latencyMs };
    }
    const d = data as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };
    if (d.error) return { ok: false, error: d.error.message || "Provider error", latencyMs };
    const content = (d.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("")
      .trim();
    if (!content) return { ok: false, error: "Empty completion", latencyMs };
    return { ok: true, content, latencyMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort/i.test(msg) ? `Timed out after ${PROVIDER_TIMEOUT_MS / 1000}s` : msg,
      latencyMs: Date.now() - started,
    };
  }
}

async function callDemoBrain(messages: Msg[]): Promise<CallResult> {
  const started = Date.now();
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const latencyMs = Date.now() - started;
    const anyRes = completion as {
      choices?: { message?: { content?: string } }[];
      content?: string;
    };
    const content = anyRes?.choices?.[0]?.message?.content ?? anyRes?.content ?? "";
    if (typeof content !== "string" || !content.length) {
      return { ok: false, error: "Demo brain returned empty response", latencyMs };
    }
    return { ok: true, content, latencyMs };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - started,
    };
  }
}

export interface ChainResult {
  ok: boolean;
  content?: string;
  via?: string;
  latencyMs?: number;
  fallbackChain: FallbackStep[];
  error?: string;
}

/**
 * Runs the provider fallback chain: tries each enabled provider in order,
 * then (optionally) the built-in demo brain. Returns the first success.
 */
export async function runAgentChain(opts: {
  providers: ChatRequest["providers"];
  messages: Msg[];
  allowDemoBrain?: boolean;
}): Promise<ChainResult> {
  const providers = (opts.providers || []).filter((p) => p && p.baseUrl && p.model).slice(0, 10);
  const fallbackChain: FallbackStep[] = [];

  for (const p of providers) {
    const result =
      p.compat === "anthropic"
        ? await callAnthropic(p.baseUrl, p.apiKey, p.model, opts.messages)
        : await callOpenAICompatible(p.baseUrl, p.apiKey, p.model, opts.messages);
    fallbackChain.push({
      provider: p.label || p.model,
      model: p.model,
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error,
    });
    if (result.ok && result.content) {
      return {
        ok: true,
        content: result.content,
        via: p.label || p.model,
        latencyMs: result.latencyMs,
        fallbackChain,
      };
    }
  }

  if (opts.allowDemoBrain !== false) {
    const demo = await callDemoBrain(opts.messages);
    fallbackChain.push({
      provider: "Deep-init demo brain",
      model: "glm",
      ok: demo.ok,
      latencyMs: demo.latencyMs,
      error: demo.error,
    });
    if (demo.ok && demo.content) {
      return {
        ok: true,
        content: demo.content,
        via: "Deep-init demo brain",
        latencyMs: demo.latencyMs,
        fallbackChain,
      };
    }
  }

  return {
    ok: false,
    fallbackChain,
    error: "All providers failed",
    latencyMs: fallbackChain.reduce((a, b) => a + (b.latencyMs || 0), 0),
  };
}
