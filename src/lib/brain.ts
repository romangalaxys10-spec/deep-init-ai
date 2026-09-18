import type { ChatRequest, FallbackStep } from "./types";
import { getZAI } from "./zai";
import { reflexReply, type ReflexContext } from "./reflex-brain";
import { brainPromptBlock, type BrainConfig } from "./brains";
import {
  AGENT_GUARDRAILS,
  executeToolCalls,
  extractToolCalls,
  sanitizeAgentText,
  sanitizeStreamText,
  TOOL_RESULTS_MARKER,
  type ToolContext,
} from "./tools";

export const PROVIDER_TIMEOUT_MS = 45_000;
/** how many tool-call rounds we run when a model leaks tool syntax as text */
export const MAX_TOOL_ROUNDS = 2;
/** Honest notice shown when every round produced tool syntax but no text. */
export const NO_TEXT_ANSWER = "The agent executed tool calls but returned no text answer.";
/** Extra "stop calling tools, answer in words" retries before the notice. */
export const NUDGE_RETRIES = 2;
/** Marker embedded in every nudge — lets callDemoBrain's reflex extraction
 *  skip synthetic user messages and keep seeing the real question. */
export const NUDGE_MARKER = "TOOL PHASE OVER";
const ANSWER_NUDGE =
  `${NUDGE_MARKER}. Using the tool results above (or your own knowledge if there are none), write the final answer to the user NOW. Plain text only — no tool calls, no <function=…> blocks, no \`\`\`tool_call fences, no internal protocol narration. If the results were insufficient, say so in one short sentence.`;

type Msg = ChatRequest["messages"][number];

/**
 * Hardened system prompt: models behind custom providers sometimes narrate
 * internal protocols or print raw tool-call syntax — these rules tell them
 * to keep internal context internal. Appended once, at engine entry.
 * When brain packs are enabled, their ported cognition layers are composed
 * right after the guardrails (same system message, single cacheable prefix).
 */
function withGuardrails(messages: Msg[], brains?: BrainConfig): Msg[] {
  const brainBlock = brainPromptBlock(brains);
  const suffix = brainBlock ? `${AGENT_GUARDRAILS}\n\n${brainBlock}` : AGENT_GUARDRAILS;
  const msgs = messages.map((m) => ({ ...m }));
  const i = msgs.findIndex((m) => m.role === "system");
  if (i >= 0) {
    msgs[i] = { ...msgs[i], content: `${msgs[i].content}\n\n${suffix}` };
  } else {
    msgs.unshift({ role: "system", content: suffix });
  }
  return msgs;
}

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
  /** provenance override — e.g. "Deep-init demo brain (offline reflex)" */
  via?: string;
  /** diagnostics from the covered demo-cloud attempt (timeout reflex path) */
  cloudAttempt?: { ok: boolean; error?: string; latencyMs: number };
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

/** How long the cloud demo tier may think before we check whether it is
 *  even reachable. On deployments with no egress the cloud call hangs in
 *  TCP-connect — unacceptable for chat/voice UX, so we race it. */
const DEMO_CLOUD_TIMEOUT_MS = 4500;
/** When the cloud tier is KNOWN reachable (probe passed / call completed),
 *  a real GLM answer is worth waiting for — cross-region completions take
 *  5–15s. This is the total budget from call start. */
const DEMO_CLOUD_SLOW_OK_MS = 25_000;
/** The reachability probe budget (DNS+TCP+TLS+HTTP to the base URL). */
const CLOUD_PROBE_TIMEOUT_MS = 2_500;
const CLOUD_HEALTH_TTL_MS = 5 * 60_000;

/** Per-instance demo-cloud health: "alive" = reachable & completing →
 *  skip the short race and wait for the real answer; "dead" = probe or
 *  call failed → reflex instantly instead of burning the race window. */
let cloudHealth: { state: "alive" | "dead"; at: number } | null = null;

function noteCloudHealth(state: "alive" | "dead") {
  cloudHealth = { state, at: Date.now() };
}

function cloudIsAlive(): boolean {
  return cloudHealth?.state === "alive" && Date.now() - cloudHealth.at < CLOUD_HEALTH_TTL_MS;
}

/**
 * Reachability probe — a bare GET to the model base URL. ANY response
 * (even 401/404) proves DNS+TCP+TLS work from this deployment; a throw
 * means unreachable and the reflex tier must cover instantly.
 */
async function probeCloudReachable(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), CLOUD_PROBE_TIMEOUT_MS);
  try {
    await fetch(baseUrl, { signal: controller.signal, cache: "no-store" });
    return true; // any HTTP status = reachable
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The LAST real user turn + the tool results gathered for it.
 *
 * Synthetic messages injected by the engine (tool-results feedback,
 * answer nudges) are skipped — they are engine plumbing, and echoing
 * them back as "I heard you: [AUTOMATED TOOL RESULTS…]" was a
 * production bug. The tool results themselves are returned separately
 * so the reflex tier can answer from real gathered data.
 */
export function extractReflexContext(messages: Msg[]): { userText: string; toolResults: string } {
  let userText = "";
  let toolResults = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || typeof m.content !== "string") continue;
    if (m.content.includes(NUDGE_MARKER)) continue;
    if (m.content.startsWith(TOOL_RESULTS_MARKER)) {
      if (!toolResults) toolResults = m.content;
      continue;
    }
    userText = m.content;
    break;
  }
  return { userText, toolResults };
}

async function callDemoBrain(messages: Msg[], reflexCtx?: { hasProviders?: boolean; providerError?: string }): Promise<CallResult> {
  const started = Date.now();

  const cloud = (async (): Promise<CallResult> => {
    try {
      const zai = await getZAI();
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
      /* Cloud demo tier unreachable (no egress / no credentials)? */
      void e;
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    }
  })();

  const reflexFrom = () => {
    const { userText, toolResults } = extractReflexContext(messages);
    const ctx: ReflexContext = {
      toolResults: toolResults || undefined,
      hasProviders: reflexCtx?.hasProviders,
      providerError: reflexCtx?.providerError,
    };
    return reflexReply(userText, ctx);
  };

  const at = (ms: number) =>
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), Math.max(0, ms - (Date.now() - started))));

  const finishWithReflex = (attempt: NonNullable<CallResult["cloudAttempt"]>): CallResult => {
    const reflex = reflexFrom();
    return { ok: true, content: reflex.content, via: reflex.via, latencyMs: Date.now() - started, cloudAttempt: attempt };
  };

  /*
   * Two-phase cloud race — the fix for "why can't the built-in zai brain
   * answer before a user provider exists":
   *  Phase 1: race the cloud call against the fast reflex window. Winner
   *           returns/reflects immediately — UX never degrades.
   *  Phase 2: on timeout, probe the endpoint SYNCHRONOUSLY (a bare GET;
   *           any HTTP status proves reachability — DNS/TCP/TLS work).
   *           • unreachable → reflex right away (endpoint truly dead)
   *           • reachable   → the model is just SLOW (cross-region GLM
   *             takes 5–15s) → keep waiting within the slow-ok budget and
   *             return the REAL demo-brain answer. This is exactly the
   *             "use the internal tunnel AI in reflex mode" behavior.
   * The old fixed 4.5s race reflexed EVERY call on Vercel (background
   * diagnosis can't run there — lambdas freeze after the response), so
   * the built-in brain never got a fair chance.
   */
  const firstDeadline = cloudIsAlive() ? DEMO_CLOUD_SLOW_OK_MS : DEMO_CLOUD_TIMEOUT_MS;
  const winner = await Promise.race([cloud, at(firstDeadline)]);

  if (winner !== "timeout") {
    if (winner.ok) {
      noteCloudHealth("alive");
      return winner;
    }
    noteCloudHealth("dead");
    return finishWithReflex({ ok: false, error: winner.error, latencyMs: winner.latencyMs });
  }

  if (firstDeadline === DEMO_CLOUD_SLOW_OK_MS) {
    // health said alive, yet it outlived even the slow budget — model path broken
    noteCloudHealth("dead");
    return finishWithReflex({ ok: false, error: "cloud exceeded the slow-ok budget", latencyMs: Date.now() - started });
  }

  /* Phase 2 — reachability probe */
  const probeUrl = process.env.ZAI_BASE_URL || "https://api.z.ai";
  const reachable = await probeCloudReachable(probeUrl);
  if (!reachable) {
    noteCloudHealth("dead");
    return finishWithReflex({ ok: false, error: "model endpoint unreachable (probe failed)", latencyMs: Date.now() - started });
  }

  /* reachable → wait for the real answer within the slow-ok budget */
  noteCloudHealth("alive");
  const second = await Promise.race([cloud, at(DEMO_CLOUD_SLOW_OK_MS)]);
  if (second !== "timeout") {
    noteCloudHealth(second.ok ? "alive" : "dead");
    if (second.ok) return second;
    return finishWithReflex({ ok: false, error: second.error, latencyMs: second.latencyMs });
  }
  noteCloudHealth("dead");
  return finishWithReflex({ ok: false, error: "cloud exceeded the slow-ok budget", latencyMs: Date.now() - started });
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
  /** gateway context for agent-scoped tools (memory, reminders) */
  toolCtx?: ToolContext;
  /** enabled cognition packs (Hermes / Moltis brains) */
  brains?: BrainConfig;
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
async function callDemoBrainReplayed(
  messages: Msg[],
  onEvent?: StreamOpts["onEvent"],
  reflexCtx?: { hasProviders?: boolean; providerError?: string }
): Promise<CallResult> {
  const demo = await callDemoBrain(messages, reflexCtx);
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

/* One streaming pass through the provider chain (+ demo brain).
   Appends diagnostics to fallbackChain; deltas flow through onEvent. */
async function runChainOnceStreaming(
  providers: StreamOpts["providers"],
  messages: Msg[],
  allowDemoBrain: boolean | undefined,
  fallbackChain: FallbackStep[],
  onEvent?: StreamOpts["onEvent"]
): Promise<ChainResult> {
  for (const p of providers) {
    onEvent?.({ type: "provider_start", label: p.label || p.model, model: p.model });
    const result =
      p.compat === "anthropic"
        ? await callAnthropicStream(p.baseUrl, p.apiKey, p.model, messages, onEvent)
        : await callOpenAICompatibleStream(p.baseUrl, p.apiKey, p.model, messages, onEvent);
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

  if (allowDemoBrain !== false) {
    const demo = await callDemoBrainReplayed(messages, onEvent, {
      hasProviders: providers.length > 0,
      providerError: fallbackChain.find((s) => !s.ok)?.error,
    });
    if (demo.cloudAttempt && !demo.cloudAttempt.ok) {
      fallbackChain.push({
        provider: "Deep-init demo brain (cloud attempt)",
        model: "glm",
        ok: false,
        latencyMs: demo.cloudAttempt.latencyMs,
        error: demo.cloudAttempt.error,
      });
    }
    fallbackChain.push({
      provider: demo.via || "Deep-init demo brain",
      model: "glm",
      ok: demo.ok,
      latencyMs: demo.latencyMs,
      error: demo.error,
    });
    if (demo.ok && demo.content) {
      return {
        ok: true,
        content: demo.content,
        via: demo.via || "Deep-init demo brain",
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
 * Streaming variant of runAgentChain, Hermes/OpenClaw style: tokens flow
 * through onEvent as they arrive, and if the model "leaks" tool-call syntax
 * as text (<function=...> etc.) the tools are executed server-side and the
 * model gets a follow-up round with the results. Viewers never see raw tool
 * syntax — every emitted delta is sanitized, and the final content is the
 * clean answer (intermediate tool-narration stays preview-only).
 */
export async function runAgentChainStreaming(opts: StreamOpts): Promise<ChainResult> {
  const providers = (opts.providers || []).filter((p) => p && p.baseUrl && p.model).slice(0, 10);
  const fallbackChain: FallbackStep[] = [];
  let messages = withGuardrails(opts.messages, opts.brains);
  let prefix = ""; // visible text from completed tool rounds (preview-only)

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const emit: StreamOpts["onEvent"] = (ev) => {
      if (ev.type === "provider_start") {
        opts.onEvent?.(ev);
        return;
      }
      // never let tool syntax (complete or half-streamed) reach a viewer
      opts.onEvent?.({ type: "delta", text: sanitizeStreamText(prefix + ev.text) });
    };

    const result = await runChainOnceStreaming(
      providers,
      messages,
      opts.allowDemoBrain,
      fallbackChain,
      emit
    );

    if (!result.ok || !result.content) {
      return {
        ok: false,
        fallbackChain,
        error: result.error || "All providers failed",
        latencyMs: fallbackChain.reduce((a, b) => a + (b.latencyMs || 0), 0),
        ...(prefix.trim() ? { partial: true } : {}),
      };
    }

    const { calls, cleaned } = extractToolCalls(result.content);
    const visible = sanitizeAgentText(cleaned);

    if (!calls.length || round === MAX_TOOL_ROUNDS) {
      if (!visible && !prefix.trim()) {
        /* Tool-mute auto-retry (mirrors runAgentChain): execute any pending
           calls, then force a plain-text answer with nudge retries. The
           emit wrapper keeps every delta sanitized for viewers. */
        const feedback = calls.length ? await executeToolCalls(calls, opts.toolCtx) : "";
        const nudge = [feedback, ANSWER_NUDGE].filter(Boolean).join("\n\n");
        let retryMsgs: Msg[] = [
          ...messages,
          { role: "assistant", content: result.content },
          { role: "user", content: nudge },
        ];
        for (let attempt = 0; attempt < NUDGE_RETRIES; attempt++) {
          const retry = await runChainOnceStreaming(
            providers,
            retryMsgs,
            opts.allowDemoBrain,
            fallbackChain,
            emit
          );
          if (!retry.ok || !retry.content) break;
          const { cleaned: rCleaned } = extractToolCalls(retry.content);
          const rVisible = sanitizeAgentText(rCleaned);
          if (rVisible) {
            const content = prefix.trim() ? `${prefix.trim()}\n\n${rVisible}` : rVisible;
            return {
              ok: true,
              content,
              via: retry.via,
              latencyMs: retry.latencyMs,
              fallbackChain,
            };
          }
          retryMsgs = [
            ...retryMsgs,
            { role: "assistant", content: retry.content },
            { role: "user", content: ANSWER_NUDGE },
          ];
        }
        return {
          ok: true,
          content: NO_TEXT_ANSWER,
          via: result.via,
          latencyMs: result.latencyMs,
          fallbackChain,
        };
      }
      const content =
        visible || prefix.trim() || NO_TEXT_ANSWER;
      return {
        ok: true,
        content,
        via: result.via,
        latencyMs: result.latencyMs,
        fallbackChain,
      };
    }

    // real tool execution, then a follow-up round with the results
    const feedback = await executeToolCalls(calls, opts.toolCtx);
    prefix = visible ? `${visible}\n\n` : `${prefix}\n\n`;
    messages = [
      ...messages,
      { role: "assistant", content: result.content },
      { role: "user", content: feedback },
    ];
  }

  return {
    ok: false,
    fallbackChain,
    error: "All providers failed",
    latencyMs: fallbackChain.reduce((a, b) => a + (b.latencyMs || 0), 0),
  };
}

/* One classic (non-streaming) pass through the provider chain (+ demo brain). */
async function runChainOnce(
  providers: ChatRequest["providers"],
  messages: Msg[],
  allowDemoBrain: boolean | undefined,
  fallbackChain: FallbackStep[]
): Promise<ChainResult> {
  for (const p of providers) {
    const result =
      p.compat === "anthropic"
        ? await callAnthropic(p.baseUrl, p.apiKey, p.model, messages)
        : await callOpenAICompatible(p.baseUrl, p.apiKey, p.model, messages);
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

  if (allowDemoBrain !== false) {
    const demo = await callDemoBrain(messages, {
      hasProviders: providers.length > 0,
      providerError: fallbackChain.find((s) => !s.ok)?.error,
    });
    if (demo.cloudAttempt && !demo.cloudAttempt.ok) {
      fallbackChain.push({
        provider: "Deep-init demo brain (cloud attempt)",
        model: "glm",
        ok: false,
        latencyMs: demo.cloudAttempt.latencyMs,
        error: demo.cloudAttempt.error,
      });
    }
    fallbackChain.push({
      provider: demo.via || "Deep-init demo brain",
      model: "glm",
      ok: demo.ok,
      latencyMs: demo.latencyMs,
      error: demo.error,
    });
    if (demo.ok && demo.content) {
      return {
        ok: true,
        content: demo.content,
        via: demo.via || "Deep-init demo brain",
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
 * Runs the provider fallback chain with tool-call defense: if the model
 * leaks tool-call syntax as text, the tools are executed server-side and
 * the model answers again with the results. The reply that reaches the
 * user is always sanitized — raw <function=...> syntax can never leak.
 */
export async function runAgentChain(opts: {
  providers: ChatRequest["providers"];
  messages: Msg[];
  allowDemoBrain?: boolean;
  toolCtx?: ToolContext;
  brains?: BrainConfig;
}): Promise<ChainResult> {
  const providers = (opts.providers || []).filter((p) => p && p.baseUrl && p.model).slice(0, 10);
  const fallbackChain: FallbackStep[] = [];
  let messages = withGuardrails(opts.messages, opts.brains);

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await runChainOnce(providers, messages, opts.allowDemoBrain, fallbackChain);

    if (!result.ok || !result.content) {
      return {
        ok: false,
        fallbackChain,
        error: result.error || "All providers failed",
        latencyMs: fallbackChain.reduce((a, b) => a + (b.latencyMs || 0), 0),
      };
    }

    const { calls, cleaned } = extractToolCalls(result.content);
    const visible = sanitizeAgentText(cleaned);

    if (!calls.length || round === MAX_TOOL_ROUNDS) {
      if (!visible) {
        /* Tool-mute auto-retry: the model spent the whole conversation
           emitting tool-call syntax with no user-visible text. Execute any
           pending calls so their results aren't dropped, then explicitly
           order a plain-text final answer and retry — only after
           NUDGE_RETRIES failed attempts do we return the honest notice. */
        const feedback = calls.length ? await executeToolCalls(calls, opts.toolCtx) : "";
        const nudge = [feedback, ANSWER_NUDGE].filter(Boolean).join("\n\n");
        let retryMsgs: Msg[] = [
          ...messages,
          { role: "assistant", content: result.content },
          { role: "user", content: nudge },
        ];
        for (let attempt = 0; attempt < NUDGE_RETRIES; attempt++) {
          const retry = await runChainOnce(providers, retryMsgs, opts.allowDemoBrain, fallbackChain);
          if (!retry.ok || !retry.content) break;
          const { cleaned: rCleaned } = extractToolCalls(retry.content);
          const rVisible = sanitizeAgentText(rCleaned);
          if (rVisible) {
            /* any tool syntax in a nudged reply is noise at this point —
               accept the text answer */
            return {
              ok: true,
              content: rVisible,
              via: retry.via,
              latencyMs: retry.latencyMs,
              fallbackChain,
            };
          }
          retryMsgs = [
            ...retryMsgs,
            { role: "assistant", content: retry.content },
            { role: "user", content: ANSWER_NUDGE },
          ];
        }
        return {
          ok: true,
          content: NO_TEXT_ANSWER,
          via: result.via,
          latencyMs: result.latencyMs,
          fallbackChain,
        };
      }
      return {
        ok: true,
        content: visible,
        via: result.via,
        latencyMs: result.latencyMs,
        fallbackChain,
      };
    }

    // real tool execution, then a follow-up round with the results
    const feedback = await executeToolCalls(calls, opts.toolCtx);
    messages = [
      ...messages,
      { role: "assistant", content: result.content },
      { role: "user", content: feedback },
    ];
  }

  return {
    ok: false,
    fallbackChain,
    error: "All providers failed",
    latencyMs: fallbackChain.reduce((a, b) => a + (b.latencyMs || 0), 0),
  };
}
