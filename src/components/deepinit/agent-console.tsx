"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildSystemPrompt, uid, useDeepInit } from "@/lib/store";
import { useT } from "@/lib/i18n";
import type { ChatMessage, FallbackStep } from "@/lib/types";
import { AlertTriangle, CornerDownLeft, Loader2, Send, TerminalSquare, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RichText } from "./rich-text";
import { MonoLabel, StatusDot } from "./ui-bits";
import { MicButton, VoiceControls, useSpeak } from "./voice";

const SUGGESTIONS = ["cs.sug1", "cs.sug2", "cs.sug3", "cs.sug4"];

export function AgentConsole() {
  const t = useT();
  const messages = useDeepInit((s) => s.messages);
  const addMessage = useDeepInit((s) => s.addMessage);
  const updateMessage = useDeepInit((s) => s.updateMessage);
  const profile = useDeepInit((s) => s.profile);
  const q = useDeepInit((s) => s.questionnaire);
  const channels = useDeepInit((s) => s.channels);
  const providers = useDeepInit((s) => s.providers);
  const tools = useDeepInit((s) => s.tools);
  const instances = useDeepInit((s) => s.instances);
  const tunnels = useDeepInit((s) => s.tunnels);
  const skills = useDeepInit((s) => s.skills);
  const voice = useDeepInit((s) => s.voice);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();
  const { speak, speakingId, stop } = useSpeak();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => messages.filter((m) => m.role !== "system"), [messages]);

  const enabledProviders = useMemo(
    () =>
      [...providers]
        .filter((p) => p.enabled && p.baseUrl && p.model)
        .sort((a, b) => a.priority - b.priority)
        .map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, compat: p.compat })),
    [providers]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visible.length, sending]);

  // auto-speak new assistant replies
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voice.enabled || !voice.autoSpeak) return;
    const last = visible[visible.length - 1];
    if (last && last.role === "assistant" && last.content && last.id !== lastSpokenRef.current) {
      lastSpokenRef.current = last.id;
      speak(last.content, last.id);
    }
  }, [visible, voice.enabled, voice.autoSpeak, speak]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    setInput("");
    setSending(true);

    const userMsg: ChatMessage = { id: uid(), role: "user", content, at: new Date().toISOString() };
    addMessage(userMsg);

    const history = [...visible, userMsg]
      .slice(-20)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const system = buildSystemPrompt(profile, q, channels, tools, instances, tunnels, skills);

    const placeholderId = uid();
    addMessage({
      id: placeholderId,
      role: "assistant",
      content: "",
      at: new Date().toISOString(),
      via: "…",
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: system }, ...history],
          providers: enabledProviders,
          allowDemoBrain: true,
          stream: true,
        }),
      });

      const ctype = res.headers.get("content-type") || "";

      if (res.ok && ctype.includes("ndjson") && res.body) {
        /* ---- streaming mode: NDJSON lines, token deltas live ---- */
        setStreamingId(placeholderId);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev: {
              type: string;
              text?: string;
              label?: string;
              ok?: boolean;
              content?: string;
              via?: string;
              latencyMs?: number;
              fallbackChain?: FallbackStep[];
              error?: string;
            };
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.type === "provider_start" && ev.label) {
              updateMessage(placeholderId, { via: ev.label });
            } else if (ev.type === "delta" && typeof ev.text === "string") {
              updateMessage(placeholderId, { content: ev.text, via: "…" });
            } else if (ev.type === "done") {
              streamDone = true;
              if (ev.ok && ev.content) {
                updateMessage(placeholderId, {
                  content: ev.content,
                  via: ev.via,
                  latencyMs: ev.latencyMs,
                  fallbackChain: ev.fallbackChain,
                });
                logActivity({
                  kind: "message",
                  title: `Task handled via ${ev.via}`,
                  detail: `${ev.latencyMs}ms${(ev.fallbackChain || []).some((s) => !s.ok) ? " · fallback engaged" : ""} · instances: ${instances.length + tunnels.filter((t) => t.status !== "pending").length}`,
                });
              } else {
                updateMessage(placeholderId, {
                  content: "⚠ All brains in the chain failed. Add another provider or check the endpoint/key of an existing one.",
                  via: "error",
                  fallbackChain: ev.fallbackChain,
                });
                logActivity({ kind: "error", title: "All providers failed a task", detail: content.slice(0, 80) });
                toast({ title: t("cs.toastFailTitle"), description: t("cs.toastFailBody"), variant: "destructive" });
              }
            }
          }
        }
        setStreamingId(null);
      } else {
        /* ---- legacy JSON fallback ---- */
        const data = await res.json();
        if (res.ok && data.content) {
          updateMessage(placeholderId, {
            content: data.content,
            via: data.via,
            latencyMs: data.latencyMs,
            fallbackChain: data.fallbackChain,
          });
          logActivity({
            kind: "message",
            title: `Task handled via ${data.via}`,
            detail: `${data.latencyMs}ms${(data.fallbackChain || []).some((s: { ok: boolean }) => !s.ok) ? " · fallback engaged" : ""} · instances: ${instances.length + tunnels.filter((t) => t.status !== "pending").length}`,
          });
        } else {
          updateMessage(placeholderId, {
            content: "⚠ All brains in the chain failed. Add another provider or check the endpoint/key of an existing one.",
            via: "error",
            fallbackChain: data.fallbackChain,
          });
          logActivity({ kind: "error", title: "All providers failed a task", detail: content.slice(0, 80) });
          toast({ title: t("cs.toastFailTitle"), description: t("cs.toastFailBody"), variant: "destructive" });
        }
      }
    } catch (e) {
      updateMessage(placeholderId, {
        content: `⚠ Network error: ${e instanceof Error ? e.message : String(e)}`,
        via: "error",
      });
    } finally {
      setStreamingId(null);
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-13.5rem)] min-h-[440px] flex-col rounded-xl border border-border bg-card/60">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <TerminalSquare className="h-4 w-4 text-primary" />
          <MonoLabel>{t("cs.title", { agent: profile.agentName })}</MonoLabel>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            {instances.length + tunnels.filter((t) => t.status !== "pending").length > 0
              ? t("cs.machines", { n: instances.length + tunnels.filter((x) => x.status !== "pending").length })
              : t("cs.noMachines")}
          </span>
          <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <StatusDot ok />
            {enabledProviders.length > 0
              ? t("cs.brainsArmed", { n: enabledProviders.length, s: enabledProviders.length > 1 ? "s" : "" })
              : t("stat.demoBrain")}
          </span>
          <VoiceControls speak={speak} />
        </div>
      </div>

      {/* messages */}
      <div className="di-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {visible.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="di-glow flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10">
              <TerminalSquare className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold">{t("cs.emptyTitle", { agent: profile.agentName })}</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("cs.emptyBody")}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(t(s))}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {t(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {visible.map((m) => (
          <MessageBubble
            key={m.id}
            m={m}
            agentName={profile.agentName}
            streaming={m.id === streamingId}
            onSpeak={voice.enabled ? () => speak(m.content, m.id) : undefined}
            speaking={speakingId === m.id}
            onStopSpeak={stop}
          />
        ))}
        {sending && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {t("cs.working", { agent: profile.agentName })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <div className="border-t border-border/70 p-3">
        <div className="flex items-end gap-2">
          <span className="pb-3 font-mono text-sm text-primary">❯</span>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("cs.placeholder", { agent: profile.agentName })}
            className="min-h-[52px] flex-1 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
            rows={2}
          />
          <MicButton onText={(t) => setInput((cur) => (cur ? `${cur} ${t}` : t))} />
          <Button onClick={() => send()} disabled={sending || !input.trim()} size="icon" className="mb-1 h-9 w-9 shrink-0" aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-1 flex items-center gap-1.5 pl-5 font-mono text-[10px] text-muted-foreground">
          <CornerDownLeft className="h-3 w-3" /> {t("cs.hint")}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  m,
  agentName,
  streaming,
  onSpeak,
  speaking,
  onStopSpeak,
}: {
  m: ChatMessage;
  agentName: string;
  streaming?: boolean;
  onSpeak?: () => void;
  speaking?: boolean;
  onStopSpeak?: () => void;
}) {
  const isUser = m.role === "user";
  const failedSteps = (m.fallbackChain || []).filter((s) => !s.ok);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
          {m.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] space-y-1.5">
        <div className="rounded-2xl rounded-bl-md border border-border bg-secondary/50 px-4 py-2.5 text-sm leading-relaxed">
          {m.content ? (
            <RichText content={m.content} />
          ) : (
            <span className="text-muted-foreground">…</span>
          )}
          {streaming && <span className="di-cursor text-primary">▊</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-1 font-mono text-[10px] text-muted-foreground">
          <span className="text-primary">{agentName}</span>
          {m.via && m.via !== "…" && m.via !== "error" && (
            <span>
              via <span className="text-foreground/80">{m.via}</span>
              {m.latencyMs ? ` · ${m.latencyMs}ms` : ""}
            </span>
          )}
          {failedSteps.length > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <AlertTriangle className="h-3 w-3" /> fallback engaged ({failedSteps.map((f) => f.provider).join(", ")} failed)
            </span>
          )}
          {onSpeak && m.content && (
            <button
              onClick={speaking ? onStopSpeak : onSpeak}
              className={`inline-flex items-center gap-1 transition-colors ${speaking ? "text-primary" : "hover:text-foreground"}`}
              aria-label={speaking ? "Stop speaking" : "Speak reply"}
            >
              <Volume2 className="h-3 w-3" />
              {speaking ? "stop" : "speak"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
