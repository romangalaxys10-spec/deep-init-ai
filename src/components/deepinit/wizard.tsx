"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { uid, useDeepInit } from "@/lib/store";
import type { AIProvider, ProviderCompat } from "@/lib/types";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  RefreshCcw,
  Send,
  Trash2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { MonoLabel, Panel, StatusDot } from "./ui-bits";
import { ChannelLine, ProviderLine, StepQuestionnaire, StepReview } from "./wizard-steps-b";

const WIZARD_STEPS = ["Operator", "Messengers", "AI brains", "Directives", "Initialize"] as const;

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
              you&apos;ll be typing this name a lot on WhatsApp — choose something short
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
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!valid} className="font-mono">
          Next: pair messengers →
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Step 2: messengers ---------------- */

function StepChannels({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const channels = useDeepInit((s) => s.channels);
  const addChannel = useDeepInit((s) => s.addChannel);
  const { toast } = useToast();

  return (
    <div className="di-fade-up space-y-6">
      <div>
        <MonoLabel className="mb-2">{`/// step 2 of 5 — messengers`}</MonoLabel>
        <h2 className="text-2xl font-bold tracking-tight">Where do you want to reach your agent?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pair WhatsApp or Telegram — or both. This is your 24/7 hotline to it, and its hotline to you.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WhatsAppCard
          channel={channels.find((c) => c.type === "whatsapp")}
          onPair={(c) => {
            addChannel(c);
            toast({ title: "WhatsApp paired", description: "Gateway session linked to this agent." });
          }}
        />
        <TelegramCard
          channel={channels.find((c) => c.type === "telegram")}
          onPair={(c) => {
            addChannel(c);
            toast({ title: "Telegram paired", description: "Bot verified and attached to the agent." });
          }}
        />
      </div>

      <p className="text-center font-mono text-[11px] text-muted-foreground">
        you can skip this and pair later from the console
      </p>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="font-mono">← Back</Button>
        <Button onClick={onNext} className="font-mono">Next: connect AI brains →</Button>
      </div>
    </div>
  );
}

export function WhatsAppCard({
  channel,
  onPair,
}: {
  channel?: { id: string; type: "whatsapp" | "telegram"; status: "pending" | "connected" | "error"; label: string; handle?: string; pairingCode?: string; connectedAt?: string };
  onPair: (c: { id: string; type: "whatsapp" | "telegram"; status: "pending" | "connected" | "error"; label: string; handle?: string; pairingCode?: string; connectedAt?: string }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState<string | null>(channel?.pairingCode || null);
  const [confirming, setConfirming] = useState(false);

  const startPairing = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pair/whatsapp", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setCode(data.code);
      }
    } finally {
      setLoading(false);
    }
  };

  const confirm = () => {
    setConfirming(true);
    setTimeout(() => {
      onPair({
        id: uid(),
        type: "whatsapp",
        status: "connected",
        label: "WhatsApp",
        pairingCode: code || undefined,
        handle: "+•• •• ••• ••" + (code ? code.slice(-2) : ""),
        connectedAt: new Date().toISOString(),
      });
      setConfirming(false);
    }, 1400);
  };

  if (channel?.status === "connected") {
    return (
      <Panel className="p-5">
        <CardHeader icon={<MessageCircle className="h-5 w-5 text-primary" />} title="WhatsApp" />
        <div className="mt-4 space-y-3">
          <ChannelLine c={channel} />
          <p className="font-mono text-[11px] text-muted-foreground">gateway session active · re-pair anytime</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <CardHeader icon={<MessageCircle className="h-5 w-5 text-primary" />} title="WhatsApp" />
      {!code ? (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">
            One-time pairing code — the Deep-init gateway binds your number to this agent. Your chats stay on your device.
          </p>
          <Button onClick={startPairing} disabled={loading} className="mt-4 w-full font-mono">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Phone className="mr-2 h-4 w-4" />}
            Generate pairing code
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="di-glow rounded-lg border border-primary/40 bg-primary/10 p-4 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">pairing code</div>
            <div className="di-text-glow mt-1 font-mono text-2xl font-bold tracking-widest text-primary">{code}</div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">expires in 3 min</div>
          </div>
          <ol className="space-y-1.5 text-xs text-muted-foreground">
            <li>1. Open WhatsApp on your phone</li>
            <li>2. Settings → Linked devices → Link a device</li>
            <li>3. Choose &quot;Link with phone number instead&quot;</li>
            <li>4. Enter the code above on the gateway</li>
          </ol>
          <Button onClick={confirm} disabled={confirming} className="w-full font-mono">
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {confirming ? "Linking device..." : "I've entered the code"}
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function TelegramCard({ channel, onPair }: { channel?: Parameters<typeof ChannelLine>[0]["c"]; onPair: (c: Parameters<typeof ChannelLine>[0]["c"]) => void }) {
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/pair/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        onPair({
          id: uid(),
          type: "telegram",
          status: "connected",
          label: "Telegram",
          handle: `@${data.bot.username}`,
          connectedAt: new Date().toISOString(),
        });
      } else {
        setError(data.error || "Verification failed");
      }
    } catch {
      setError("Network error while reaching the verification service");
    } finally {
      setChecking(false);
    }
  };

  if (channel?.status === "connected") {
    return (
      <Panel className="p-5">
        <CardHeader icon={<Send className="h-5 w-5 text-primary" />} title="Telegram" />
        <div className="mt-4 space-y-3">
          <ChannelLine c={channel} />
          <p className="font-mono text-[11px] text-muted-foreground">gateway polling updates for this bot</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <CardHeader icon={<Send className="h-5 w-5 text-primary" />} title="Telegram" />
      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Create a bot with <span className="font-mono text-foreground">@BotFather</span>, paste its token here — it&apos;s verified
          live against Telegram.
        </p>
        <Input
          placeholder="123456789:AAExample_Token_From_BotFather"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono text-xs"
          type="password"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Button onClick={verify} disabled={checking || token.trim().length < 10} className="w-full font-mono">
          {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
          {checking ? "Verifying with Telegram..." : "Verify & pair bot"}
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

function CardHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/70 pb-3">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="font-semibold">{title}</span>
      </div>
      <StatusDot ok={false} />
    </div>
  );
}

export { WIZARD_STEPS };
