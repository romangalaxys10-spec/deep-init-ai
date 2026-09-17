"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { buildSystemPrompt, uid, useDeepInit } from "@/lib/store";
import type { AIProvider, ProviderCompat } from "@/lib/types";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  RefreshCcw,
  Send,
  Trash2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CopyField, MonoLabel, Panel, StatusDot } from "./ui-bits";
import { ChannelLine, ProviderLine, StepQuestionnaire, StepReview } from "./wizard-steps-b";

const WIZARD_STEPS = ["Operator", "Telegram", "AI brains", "Directives", "Initialize"] as const;

const PRESETS: { label: string; baseUrl: string; model: string; compat: ProviderCompat; keyHint?: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", compat: "openai" },
  { label: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514", compat: "anthropic" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", compat: "openai" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", compat: "openai" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", compat: "openai" },
  { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", compat: "openai" },
  { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", compat: "openai" },
  { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.1", compat: "openai", keyHint: "no key needed" },
  { label: "Custom / self-hosted", baseUrl: "", model: "", compat: "openai" },
];

const COMMON_TZ = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Tbilisi",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

export function Wizard({ onInitialize }: { onInitialize: () => void }) {
  const step = useDeepInit((s) => s.wizardStep);
  const setStep = useDeepInit((s) => s.setWizardStep);

  return (
    <div className="di-grid-bg min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {/* progress rail */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          {WIZARD_STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => i < step && setStep(i)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                i === step
                  ? "border-primary/70 bg-primary/15 text-foreground"
                  : i < step
                    ? "border-primary/30 bg-transparent text-primary hover:bg-primary/5"
                    : "border-border text-muted-foreground"
              }`}
            >
              <span className={i <= step ? "text-primary" : ""}>{String(i + 1).padStart(2, "0")}</span>
              <span className="hidden sm:inline">{s}</span>
            </button>
          ))}
        </div>

        {step === 0 && <StepIdentity onNext={() => setStep(1)} />}
        {step === 1 && <StepChannels onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <StepProviders onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <StepQuestionnaire onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && <StepReview onBack={() => setStep(3)} onInitialize={onInitialize} />}
      </div>
    </div>
  );
}

/* ---------------- Step 1: identity ---------------- */

function StepIdentity({ onNext }: { onNext: () => void }) {
  const profile = useDeepInit((s) => s.profile);
  const setProfile = useDeepInit((s) => s.setProfile);
  const ensureCredentials = useDeepInit((s) => s.ensureCredentials);

  const tzOptions = useMemo(() => {
    let list: string[] = COMMON_TZ;
    try {
      const intl = Intl.supportedValuesOf ? (Intl.supportedValuesOf("timeZone") as string[]) : [];
      if (intl.length) list = intl;
    } catch {
      /* keep fallback */
    }
    return list;
  }, []);

  const valid = profile.displayName.trim().length > 0 && profile.agentName.trim().length > 0;

  return (
    <div className="di-fade-up space-y-6">
      <div>
        <MonoLabel className="mb-2">{`/// step 1 of 5 — operator`}</MonoLabel>
        <h2 className="text-2xl font-bold tracking-tight">First, who is the boss?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The agent greets you by name, works in your timezone and answers to the name you give it.
        </p>
      </div>

      <Panel className="mx-auto max-w-xl p-6">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="displayName">Your name</Label>
            <Input
              id="displayName"
              placeholder="e.g. Alex"
              value={profile.displayName}
              onChange={(e) => setProfile({ displayName: e.target.value })}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agentName">Name your agent</Label>
            <Input
              id="agentName"
              placeholder="e.g. Init, Nova, Jarvis..."
              value={profile.agentName}
              onChange={(e) => setProfile({ agentName: e.target.value })}
            />
            <p className="font-mono text-[11px] text-muted-foreground">
              you&apos;ll be typing this name a lot on Telegram — choose something short
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tz">Timezone</Label>
            <Select value={profile.timezone} onValueChange={(v) => setProfile({ timezone: v })}>
              <SelectTrigger id="tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {tzOptions.map((t) => (
                  <SelectItem key={t} value={t} className="font-mono text-xs">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">
            next: the wizard generates your portal login + channel pairing token
          </p>
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button
          onClick={() => {
            ensureCredentials();
            onNext();
          }}
          disabled={!valid}
          className="font-mono"
        >
          Next: connect telegram →
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Step 2: telegram ---------------- */

function StepChannels({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const channels = useDeepInit((s) => s.channels);
  const profile = useDeepInit((s) => s.profile);
  const addChannel = useDeepInit((s) => s.addChannel);
  const { toast } = useToast();

  const channel = channels.find((c) => c.type === "telegram");

  return (
    <div className="di-fade-up space-y-6">
      <div>
        <MonoLabel className="mb-2">{`/// step 2 of 5 — telegram`}</MonoLabel>
        <h2 className="text-2xl font-bold tracking-tight">Wire up your 24/7 hotline</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use our built-in bot or pair your own — then send your Channel Pairing Token to start chatting with the
          agent.
        </p>
      </div>

      <TelegramCard
        channel={channel}
        onPair={(c) => {
          addChannel(c);
          toast({ title: "Telegram paired", description: `Bot ${c.handle} verified and attached to the agent.` });
        }}
      />

      {/* channel pairing token */}
      <Panel className="p-5">
        <div className="flex items-center justify-between border-b border-border/70 pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <MonoLabel>channel pairing token</MonoLabel>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">your master token</span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Open the bot in Telegram and send it this token as your first message. That binds the chat to your agent —
          the bot will confirm with a <span className="font-mono text-foreground">Paired ✓</span> reply and start
          answering.
        </p>
        <CopyField className="mt-3" label="send this to the bot" value={profile.pairingToken || "—"} />
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          more tokens (for friends &amp; teammates, shared or isolated) can be minted in the console → channels tab
        </p>
      </Panel>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="font-mono">← Back</Button>
        <Button onClick={onNext} className="font-mono">Next: connect AI brains →</Button>
      </div>
    </div>
  );
}

/* ---------------- Telegram card (wizard + dashboard) ---------------- */

type ChannelT = Parameters<typeof ChannelLine>[0]["c"];

export function TelegramCard({
  channel,
  onPair,
}: {
  channel?: ChannelT;
  onPair: (c: ChannelT) => void;
}) {
  const [botMode, setBotMode] = useState<"builtin" | "own">(channel?.builtIn === false ? "own" : "builtin");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<{ mode?: string; warning?: string } | null>(null);
  const profile = useDeepInit((s) => s.profile);

  const pair = async (mode: "builtin" | "own") => {
    setBusy(true);
    setError(null);
    try {
      const state = useDeepInit.getState();
      const systemPrompt = buildSystemPrompt(
        state.profile,
        state.questionnaire,
        state.channels,
        state.tools,
        state.instances,
        state.tunnels,
        state.skills
      );
      const res = await fetch("/api/pair/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          token: mode === "own" ? token.trim() : undefined,
          config: {
            agentName: state.profile.agentName,
            ownerName: state.profile.displayName,
            ownerToken: state.profile.pairingToken,
            systemPrompt,
            providers: [...state.providers]
              .filter((p) => p.enabled && p.baseUrl && p.model)
              .sort((a, b) => a.priority - b.priority)
              .map((p) => ({
                id: p.id,
                label: p.label,
                baseUrl: p.baseUrl,
                apiKey: p.apiKey,
                model: p.model,
                compat: p.compat,
              })),
            allowDemoBrain: true,
            whitelist: state.whitelist.map((w) => ({ token: w.token, name: w.name, mode: w.mode })),
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setGateway({ mode: data.gatewayMode, warning: data.warning });
        onPair({
          id: channel?.id || uid(),
          type: "telegram",
          status: "connected",
          label: mode === "builtin" ? "Telegram — built-in bot" : "Telegram",
          handle: `@${data.bot.username}`,
          connectedAt: channel?.connectedAt || new Date().toISOString(),
          sessionKey: data.sessionKey,
          gatewayMode: data.gatewayMode,
          builtIn: mode === "builtin",
        });
      } else {
        setError(data.error || "Pairing failed");
      }
    } catch {
      setError("Network error while reaching the pairing service");
    } finally {
      setBusy(false);
    }
  };

  /* ------- connected state ------- */
  if (channel?.status === "connected") {
    return (
      <Panel className="p-5">
        <div className="flex items-center justify-between border-b border-border/70 pb-3">
          <div className="flex items-center gap-2.5">
            <Send className="h-5 w-5 text-primary" />
            <span className="font-semibold">Telegram</span>
          </div>
          <div className="flex items-center gap-2">
            {channel.gatewayMode && (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {channel.gatewayMode} gateway
              </span>
            )}
            <StatusDot ok />
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <ChannelLine c={channel} />
          <CopyField label={`send this to ${channel.handle}`} value={profile.pairingToken || "—"} />
          <p className="text-xs text-muted-foreground">
            First time? Open <span className="font-mono text-foreground">{channel.handle}</span> in Telegram, send the
            token above, and the agent replies <span className="font-mono text-foreground">Paired ✓</span> — from then
            on it answers every message with its full brain chain.
          </p>
          {gateway?.warning && (
            <p className="font-mono text-[11px] text-amber-400/90">{gateway.warning}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              disabled={busy}
              onClick={() => pair(channel.builtIn === false ? "own" : "builtin")}
            >
              {busy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCcw className="mr-1.5 h-3 w-3" />}
              Resync gateway
            </Button>
            <span className="font-mono text-[11px] text-muted-foreground">
              pushes the latest brains + whitelist to the server
            </span>
          </div>
        </div>
      </Panel>
    );
  }

  /* ------- pairing state ------- */
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between border-b border-border/70 pb-3">
        <div className="flex items-center gap-2.5">
          <Send className="h-5 w-5 text-primary" />
          <span className="font-semibold">Telegram</span>
        </div>
        <StatusDot ok={false} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setBotMode("builtin")}
          className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
            botMode === "builtin" ? "border-primary/60 bg-primary/10" : "border-border hover:border-primary/30"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="h-4 w-4 text-primary" /> Built-in bot
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">@init_smart_bot — zero setup</div>
        </button>
        <button
          type="button"
          onClick={() => setBotMode("own")}
          className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
            botMode === "own" ? "border-primary/60 bg-primary/10" : "border-border hover:border-primary/30"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4 text-primary" /> My own bot
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">paste a @BotFather token</div>
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {botMode === "builtin" ? (
          <p className="text-sm text-muted-foreground">
            The Deep-init gateway already runs <span className="font-mono text-foreground">@init_smart_bot</span> on a
            public webhook. Connect it, then send your pairing token to the bot — done.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Create a bot with <span className="font-mono text-foreground">@BotFather</span>, paste its token here —
              it&apos;s verified live against Telegram and wired to a webhook.
            </p>
            <Input
              placeholder="123456789:AAExample_Token_From_BotFather"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-xs"
              type="password"
            />
          </>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Button
          onClick={() => pair(botMode)}
          disabled={busy || (botMode === "own" && token.trim().length < 10)}
          className="w-full font-mono"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
          {busy
            ? "Wiring the gateway..."
            : botMode === "builtin"
              ? "Connect built-in bot"
              : "Verify & pair bot"}
        </Button>
      </div>
    </Panel>
  );
}

/* ---------------- Step 3: providers ---------------- */

const EMPTY_NEW = { label: "", baseUrl: "", apiKey: "", model: "", compat: "openai" as ProviderCompat };

function StepProviders({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const providers = useDeepInit((s) => s.providers);
  const addProvider = useDeepInit((s) => s.addProvider);
  const updateProvider = useDeepInit((s) => s.updateProvider);
  const removeProvider = useDeepInit((s) => s.removeProvider);
  const moveProvider = useDeepInit((s) => s.moveProvider);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();

  const [form, setForm] = useState(EMPTY_NEW);
  const [presetIdx, setPresetIdx] = useState("0");
  const [testingId, setTestingId] = useState<string | null>(null);

  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

  const applyPreset = (idx: string) => {
    setPresetIdx(idx);
    const p = PRESETS[Number(idx)];
    if (!p) return;
    if (p.label === "Custom / self-hosted") {
      setForm({ ...EMPTY_NEW, label: "", baseUrl: "", model: "", compat: "openai" });
    } else {
      setForm({ ...EMPTY_NEW, label: p.label, baseUrl: p.baseUrl, model: p.model, compat: p.compat });
    }
  };

  const add = () => {
    if (!form.label.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      toast({ title: "Missing fields", description: "Name, endpoint and model are required.", variant: "destructive" });
      return;
    }
    const nextPriority = providers.length ? Math.max(...providers.map((p) => p.priority)) + 1 : 1;
    const provider: AIProvider = {
      id: uid(),
      label: form.label.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      compat: form.compat,
      enabled: true,
      priority: nextPriority,
      lastStatus: "untested",
    };
    addProvider(provider);
    logActivity({ kind: "provider", title: `Provider added: ${provider.label}`, detail: `${provider.model} @ fallback #${nextPriority}` });
    setForm(EMPTY_NEW);
    setPresetIdx("0");
    toast({ title: "Provider added", description: `${provider.label} joins the fallback chain at #${nextPriority}.` });
  };

  const test = async (p: AIProvider) => {
    setTestingId(p.id);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Reply with exactly: INIT_OK" }],
          providers: [{ id: p.id, label: p.label, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, compat: p.compat }],
          allowDemoBrain: false,
        }),
      });
      const data = await res.json();
      if (res.ok && data.content) {
        updateProvider(p.id, { lastStatus: "ok", lastLatencyMs: data.latencyMs, lastError: undefined, lastCheckedAt: new Date().toISOString() });
        logActivity({ kind: "provider", title: `Health check OK: ${p.label}`, detail: `${data.latencyMs}ms` });
        toast({ title: `${p.label} is alive`, description: `Responded in ${data.latencyMs}ms` });
      } else {
        const err = data.fallbackChain?.[0]?.error || data.error || "Test failed";
        updateProvider(p.id, { lastStatus: "error", lastError: String(err).slice(0, 200), lastCheckedAt: new Date().toISOString() });
        logActivity({ kind: "error", title: `Health check failed: ${p.label}`, detail: String(err).slice(0, 120) });
        toast({ title: `${p.label} failed`, description: String(err).slice(0, 140), variant: "destructive" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateProvider(p.id, { lastStatus: "error", lastError: msg, lastCheckedAt: new Date().toISOString() });
      toast({ title: "Test error", description: msg, variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="di-fade-up space-y-6">
      <div>
        <MonoLabel className="mb-2">{`/// step 3 of 5 — ai brains`}</MonoLabel>
        <h2 className="text-2xl font-bold tracking-tight">Connect AI providers with automatic fallback</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Any OpenAI-compatible or Anthropic endpoint works — cloud or self-hosted. The chain is tried top to bottom:
          if a brain fails, times out or rate-limits, the next one picks up the task mid-flight.
        </p>
      </div>

      {/* chain list */}
      {sorted.length > 0 && (
        <Panel className="p-5">
          <div className="flex items-center justify-between">
            <MonoLabel>fallback chain — top is primary</MonoLabel>
            <span className="font-mono text-[11px] text-muted-foreground">{sorted.length} provider{sorted.length > 1 ? "s" : ""}</span>
          </div>
          <div className="mt-3 space-y-2">
            {sorted.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2">
                <div className="flex flex-col gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0} onClick={() => moveProvider(p.id, -1)} aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === sorted.length - 1} onClick={() => moveProvider(p.id, 1)} aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <ProviderLine p={p} index={i} last={i === sorted.length - 1} />
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(v) => updateProvider(p.id, { enabled: v })}
                    aria-label="Enable provider"
                  />
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="outline" size="sm" className="h-8 font-mono text-[11px]" onClick={() => test(p)} disabled={testingId === p.id}>
                    {testingId === p.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCcw className="mr-1 h-3 w-3" />}
                    Test
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={() => removeProvider(p.id)} aria-label="Remove provider">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {sorted.some((p) => p.lastError) && (
            <p className="mt-3 font-mono text-[11px] text-red-400/80">
              last error: {sorted.find((p) => p.lastError)?.lastError}
            </p>
          )}
        </Panel>
      )}

      {/* add form */}
      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <MonoLabel>add a provider</MonoLabel>
          <span className="font-mono text-[11px] text-muted-foreground">keys are stored only in this browser</span>
        </div>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Preset</Label>
              <Select value={presetIdx} onValueChange={applyPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p, i) => (
                    <SelectItem key={p.label} value={String(i)}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="e.g. My OpenAI" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>API base URL</Label>
              <Input placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Input placeholder="gpt-4o-mini" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="font-mono text-xs" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>API key <span className="text-muted-foreground">(optional for local)</span></Label>
              <Input type="password" placeholder="sk-..." value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>API shape</Label>
              <Select value={form.compat} onValueChange={(v) => setForm({ ...form, compat: v as ProviderCompat })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI-compatible (/chat/completions)</SelectItem>
                  <SelectItem value="anthropic">Anthropic native (/v1/messages)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={add} className="font-mono">
            <Plus className="mr-2 h-4 w-4" /> Add to fallback chain
          </Button>
        </div>
      </Panel>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="font-mono">← Back</Button>
        <Button onClick={onNext} className="font-mono">
          {sorted.length ? "Next: shape its behavior →" : "Skip — use demo brain →"}
        </Button>
      </div>
    </div>
  );
}
