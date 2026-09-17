"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildSystemPrompt, uid, useDeepInit } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";
import { AlertTriangle, CornerDownLeft, Loader2, Send, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MonoLabel, StatusDot } from "./ui-bits";

const SUGGESTIONS = [
  "What can you do for me?",
  "Plan my day and brief me",
  "Set up a cron to watch a price page",
  "Write a script that organizes my downloads",
];

export function AgentConsole() {
  const messages = useDeepInit((s) => s.messages);
  const addMessage = useDeepInit((s) => s.addMessage);
  const updateMessage = useDeepInit((s) => s.updateMessage);
  const profile = useDeepInit((s) => s.profile);
  const q = useDeepInit((s) => s.questionnaire);
  const channels = useDeepInit((s) => s.channels);
  const providers = useDeepInit((s) => s.providers);
  const tools = useDeepInit((s) => s.tools);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
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

    const system = buildSystemPrompt(profile, q, channels, tools);

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
        }),
      });
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
          detail: `${data.latencyMs}ms${(data.fallbackChain || []).some((s: { ok: boolean }) => !s.ok) ? " · fallback engaged" : ""}`,
        });
      } else {
        updateMessage(placeholderId, {
          content: "⚠ All brains in the chain failed. Add another provider or check the endpoint/key of an existing one.",
          via: "error",
          fallbackChain: data.fallbackChain,
        });
        logActivity({ kind: "error", title: "All providers failed a task", detail: content.slice(0, 80) });
        toast({ title: "No brain responded", description: "Check your providers or add a fallback.", variant: "destructive" });
      }
    } catch (e) {
      updateMessage(placeholderId, {
        content: `⚠ Network error: ${e instanceof Error ? e.message : String(e)}`,
        via: "error",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-13.5rem)] min-h-[440px] flex-col rounded-xl border border-border bg-card/60">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <TerminalSquare className="h-4 w-4 text-primary" />
          <MonoLabel>{profile.agentName} console</MonoLabel>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <StatusDot ok />
          {enabledProviders.length > 0
            ? `${enabledProviders.length} brain${enabledProviders.length > 1 ? "s" : ""} armed`
            : "demo brain"}
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
              <p className="font-semibold">Command {profile.agentName} directly</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Tasks, research, automation, code — it answers with its own judgment and its own tools.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {visible.map((m) => (
          <MessageBubble key={m.id} m={m} agentName={profile.agentName} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {profile.agentName} is working the fallback chain…
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
            placeholder={`Tell ${profile.agentName} what to do… (Enter to send, Shift+Enter for newline)`}
            className="min-h-[52px] flex-1 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
            rows={2}
          />
          <Button onClick={() => send()} disabled={sending || !input.trim()} size="icon" className="mb-1 h-9 w-9 shrink-0" aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-1 flex items-center gap-1.5 pl-5 font-mono text-[10px] text-muted-foreground">
          <CornerDownLeft className="h-3 w-3" /> enter to send
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m, agentName }: { m: ChatMessage; agentName: string }) {
  const isUser = m.role === "user";
  const failedSteps = (m.fallbackChain || []).filter((s) => !s.ok);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
          {m.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] space-y-1.5">
        <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border bg-secondary/50 px-4 py-2.5 text-sm leading-relaxed">
          {m.content || "…"}
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
        </div>
      </div>
    </div>
  );
}
