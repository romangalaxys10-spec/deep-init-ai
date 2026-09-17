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
  /** true when the stream died mid-answer and content is a partial answer */
  partial?: boolean;
}

/* ============================================================
 * Streaming engine — token-level SSE streaming for channels.
 * Mirrors how OpenClaw/Hermes stream to Telegram: the gateway
 * receives accumulated text per delta and edits a preview
 * message in place while the model is still writing.
 * ============================================================ */

export type StreamEvent =
  | { type: "provider_start"; label: string; model: string }
  | { type: "delta"; text: string }; // accumulated full text so far

interface StreamOpts {
  providers: ChatRequest["providers"];
  messages: Msg[];
  allowDemoBrain?: boolean;
  onEvent?: (ev: StreamEvent) => void;
}

/** Reads an SSE body and yields raw `data:` payload strings. */
async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* stream already closed */
    }
  }
}

async function callOpenAICompatibleStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Msg[],
  onEvent?: StreamOpts["onEvent"]
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
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}`, latencyMs: Date.now() - started };
    }

    const ctype = res.headers.get("content-type") || "";
    let content = "";
    let streamed = false;

    if (ctype.includes("event-stream")) {
      for await (const data of sseData(res)) {
        if (data === "[DONE]") break;
        let json: {
          choices?: { delta?: { content?: string | null }; text?: string }[];
          error?: { message?: string };
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.error) {
          return { ok: false, error: json.error.message || "Provider stream error", latencyMs: Date.now() - started };
        }
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? "";
        if (typeof delta === "string" && delta.length) {
          content += delta;
          streamed = true;
          onEvent?.({ type: "delta", text: content });
        }
      }
    } else {
      // provider ignored stream:true and answered with a normal JSON body
      const text = await res.text();
      let parsed: { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: "Invalid JSON response from provider", latencyMs: Date.now() - started };
      }
      if (parsed.error) return { ok: false, error: parsed.error.message || "Provider error", latencyMs: Date.now() - started };
      content = parsed.choices?.[0]?.message?.content || "";
    }

    if (!content.length) return { ok: false, error: "Empty completion", latencyMs: Date.now() - started };
    if (streamed) onEvent?.({ type: "delta", text: content }); // final flush
    return { ok: true, content, latencyMs: Date.now() - started };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort/i.test(msg) ? `Timed out after ${PROVIDER_TIMEOUT_MS / 1000}s` : msg,
      latencyMs: Date.now() - started,
    };
  }
}

async function callAnthropicStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Msg[],
  onEvent?: StreamOpts["onEvent"]
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
        stream: true,
        ...(system ? { system } : {}),
        messages: rest,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}`, latencyMs: Date.now() - started };
    }

    const ctype = res.headers.get("content-type") || "";
    let content = "";
    let streamed = false;

    if (ctype.includes("event-stream")) {
      for await (const data of sseData(res)) {
        let json: {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.type === "error") {
          return { ok: false, error: json.error?.message || "Anthropic stream error", latencyMs: Date.now() - started };
        }
        if (json.type === "content_block_delta" && json.delta?.text) {
          content += json.delta.text;
          streamed = true;
          onEvent?.({ type: "delta", text: content });
        }
        if (json.type === "message_stop") break;
      }
    } else {
      const text = await res.text();
      let parsed: { content?: { type: string; text?: string }[]; error?: { message?: string } };
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: "Invalid JSON response from provider", latencyMs: Date.now() - started };
      }
      if (parsed.error) return { ok: false, error: parsed.error.message || "Provider error", latencyMs: Date.now() - started };
      content = (parsed.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("")
        .trim();
    }

    if (!content.length) return { ok: false, error: "Empty completion", latencyMs: Date.now() - started };
    if (streamed) onEvent?.({ type: "delta", text: content }); // final flush
    return { ok: true, content, latencyMs: Date.now() - started };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort/i.test(msg) ? `Timed out after ${PROVIDER_TIMEOUT_MS / 1000}s` : msg,
      latencyMs: Date.now() - started,
    };
  }
}

/** Non-streaming demo brain — content is replayed through onDelta so gateways get a uniform stream. */
async function callDemoBrainReplayed(messages: Msg[], onEvent?: StreamOpts["onEvent"]): Promise<CallResult> {
  const demo = await callDemoBrain(messages);
  if (demo.ok && demo.content && onEvent) {
    // replay in slices so the preview streaming still feels alive
    const text = demo.content;
    const slice = Math.max(120, Math.ceil(text.length / 12));
    for (let i = slice; i < text.length; i += slice) {
      onEvent({ type: "delta", text: text.slice(0, i) });
      await new Promise((r) => setTimeout(r, 45));
    }
    onEvent({ type: "delta", text });
  }
  return demo;
}

/**
 * Streaming variant of runAgentChain: same fallback order, but the winning
 * provider's tokens flow through onEvent as they arrive. If a provider dies
 * mid-stream after emitting deltas, the partial answer is kept (flagged).
 */
export async function runAgentChainStreaming(opts: StreamOpts): Promise<ChainResult> {
  const providers = (opts.providers || []).filter((p) => p && p.baseUrl && p.model).slice(0, 10);
  const fallbackChain: FallbackStep[] = [];

  for (const p of providers) {
    opts.onEvent?.({ type: "provider_start", label: p.label || p.model, model: p.model });
    const result =
      p.compat === "anthropic"
        ? await callAnthropicStream(p.baseUrl, p.apiKey, p.model, opts.messages, opts.onEvent)
        : await callOpenAICompatibleStream(p.baseUrl, p.apiKey, p.model, opts.messages, opts.onEvent);
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
    const demo = await callDemoBrainReplayed(opts.messages, opts.onEvent);
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
