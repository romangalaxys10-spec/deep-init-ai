"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { uid, useDeepInit } from "@/lib/store";
import type { AgentTool, AIProvider, ProviderCompat } from "@/lib/types";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Cable,
  Loader2,
  Plus,
  Plug2,
  Puzzle,
  RefreshCcw,
  Server,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { MonoLabel, Panel, StatusDot } from "./ui-bits";

/* ============ Brains panel (providers / fallback chain) ============ */

const PRESETS: { label: string; baseUrl: string; model: string; compat: ProviderCompat }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", compat: "openai" },
  { label: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514", compat: "anthropic" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", compat: "openai" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", compat: "openai" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", compat: "openai" },
  { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.1", compat: "openai" },
  { label: "Custom", baseUrl: "", model: "", compat: "openai" },
];

export function BrainsPanel() {
  const providers = useDeepInit((s) => s.providers);
  const addProvider = useDeepInit((s) => s.addProvider);
  const updateProvider = useDeepInit((s) => s.updateProvider);
  const removeProvider = useDeepInit((s) => s.removeProvider);
  const moveProvider = useDeepInit((s) => s.moveProvider);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();

  const [form, setForm] = useState({ label: "", baseUrl: "", apiKey: "", model: "", compat: "openai" as ProviderCompat });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

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

  const add = () => {
    if (!form.label.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      toast({ title: "Missing fields", description: "Name, endpoint and model are required.", variant: "destructive" });
      return;
    }
    const nextPriority = providers.length ? Math.max(...providers.map((p) => p.priority)) + 1 : 1;
    addProvider({
      id: uid(),
      label: form.label.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      compat: form.compat,
      enabled: true,
      priority: nextPriority,
      lastStatus: "untested",
    });
    logActivity({ kind: "provider", title: `Provider added: ${form.label.trim()}`, detail: `fallback #${nextPriority}` });
    setForm({ label: "", baseUrl: "", apiKey: "", model: "", compat: "openai" });
    setShowForm(false);
    toast({ title: "Provider added", description: `${form.label.trim()} joins the chain at #${nextPriority}.` });
  };

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-primary" />
            <MonoLabel>fallback chain — top is primary</MonoLabel>
          </div>
          <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add brain
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No custom brains yet — the agent currently runs on the built-in demo brain. Add one for real work.
            </p>
          )}
          {sorted.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <Button variant="ghost" size="icon" className="h-5 w-5" disabled={i === 0} onClick={() => moveProvider(p.id, -1)} aria-label="Move up">
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" disabled={i === sorted.length - 1} onClick={() => moveProvider(p.id, 1)} aria-label="Move down">
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                    <StatusDot ok={p.lastStatus !== "error"} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.label}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {p.model} · {p.compat}
                        {p.lastLatencyMs ? ` · ${p.lastLatencyMs}ms` : ""}
                      </div>
                    </div>
                  </div>
                  <Switch checked={p.enabled} onCheckedChange={(v) => updateProvider(p.id, { enabled: v })} aria-label="Enable" />
                </div>
                {p.lastError && (
                  <p className="mt-1 pl-3 font-mono text-[10px] text-red-400/80">{p.lastError}</p>
                )}
              </div>
              <Button variant="outline" size="sm" className="h-8 font-mono text-[11px]" onClick={() => test(p)} disabled={testingId === p.id}>
                {testingId === p.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCcw className="mr-1 h-3 w-3" />}
                Test
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={() => removeProvider(p.id)} aria-label="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </Panel>

      {showForm && (
        <Panel className="p-5">
          <MonoLabel>new brain</MonoLabel>
          <div className="mt-3 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input placeholder="Name" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              <Input placeholder="Model (e.g. gpt-4o-mini)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="font-mono text-xs" />
              <Select
                value={form.compat}
                onValueChange={(v) => {
                  const compat = v as ProviderCompat;
                  const preset = PRESETS.find((p) => p.compat === compat && v !== "openai");
                  setForm({ ...form, compat });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI-compatible</SelectItem>
                  <SelectItem value="anthropic">Anthropic native</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="font-mono text-xs" />
              <Input type="password" placeholder="API key (optional for local)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="font-mono text-xs" />
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setForm({ ...form, label: p.label === "Custom" ? "" : p.label, baseUrl: p.baseUrl, model: p.model, compat: p.compat })}
                  className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button onClick={add} className="font-mono">
              <Plus className="mr-2 h-4 w-4" /> Add to chain
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ============ Tools & MCP panel ============ */

export function ToolsPanel() {
  const tools = useDeepInit((s) => s.tools);
  const toggleTool = useDeepInit((s) => s.toggleTool);
  const addTool = useDeepInit((s) => s.addTool);
  const updateTool = useDeepInit((s) => s.updateTool);
  const removeTool = useDeepInit((s) => s.removeTool);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();

  const [form, setForm] = useState<{ kind: AgentTool["kind"]; name: string; url: string; authHeader: string }>({
    kind: "mcp",
    name: "",
    url: "",
    authHeader: "",
  });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const builtin = tools.filter((t) => t.kind === "builtin");
  const custom = tools.filter((t) => t.kind !== "builtin");

  const testTool = async (t: AgentTool) => {
    if (!t.url) {
      toast({ title: "No URL on this tool", description: "Built-in modules are managed by the kernel.", variant: "destructive" });
      return;
    }
    setTestingId(t.id);
    try {
      const res = await fetch("/api/tools/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: t.url, authHeader: t.authHeader || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        updateTool(t.id, { status: "ok", lastLatencyMs: data.latencyMs, detail: data.message });
        logActivity({ kind: "tool", title: `Tool verified: ${t.name}`, detail: data.message });
        toast({ title: `${t.name} reachable`, description: data.message });
      } else {
        updateTool(t.id, { status: "error", detail: data.error || data.message });
        logActivity({ kind: "error", title: `Tool unreachable: ${t.name}`, detail: data.error || data.message });
        toast({ title: `${t.name} unreachable`, description: data.error || data.message, variant: "destructive" });
      }
    } finally {
      setTestingId(null);
    }
  };

  const addCustom = () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast({ title: "Missing fields", description: "Name and endpoint URL are required.", variant: "destructive" });
      return;
    }
    addTool({
      id: uid(),
      kind: form.kind,
      name: form.name.trim(),
      url: form.url.trim(),
      authHeader: form.authHeader.trim() || undefined,
      enabled: true,
      status: "untested",
    });
    logActivity({ kind: "tool", title: `Tool registered: ${form.name.trim()}`, detail: `${form.kind.toUpperCase()} · ${form.url.trim().slice(0, 60)}` });
    setForm({ kind: "mcp", name: "", url: "", authHeader: "" });
    setShowForm(false);
    toast({ title: "Tool registered", description: "The agent can now discover and use this endpoint." });
  };

  const kindIcon = (k: AgentTool["kind"]) =>
    k === "mcp" ? <Server className="h-4 w-4 text-primary" /> : k === "api" ? <Cable className="h-4 w-4 text-primary" /> : k === "plugin" ? <Puzzle className="h-4 w-4 text-primary" /> : <Boxes className="h-4 w-4 text-primary" />;

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" />
          <MonoLabel>built-in capability modules</MonoLabel>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {builtin.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{t.detail}</div>
              </div>
              <Switch checked={t.enabled} onCheckedChange={() => toggleTool(t.id)} aria-label={`Toggle ${t.name}`} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plug2 className="h-4 w-4 text-primary" />
            <MonoLabel>MCP servers · APIs · plugins</MonoLabel>
          </div>
          <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Register endpoint
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {custom.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Point the agent at any MCP server, REST API or plugin endpoint. It will discover capabilities and self-wire them into its toolkit.
            </p>
          )}
          {custom.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <StatusDot ok={t.status === "error" ? false : t.status === "ok" ? true : "warn"} />
                {kindIcon(t.kind)}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {t.kind.toUpperCase()} · {t.url}
                    {t.lastLatencyMs ? ` · ${t.lastLatencyMs}ms` : ""}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Switch checked={t.enabled} onCheckedChange={() => toggleTool(t.id)} aria-label="Enable tool" />
                <Button variant="outline" size="sm" className="h-8 font-mono text-[11px]" onClick={() => testTool(t)} disabled={testingId === t.id}>
                  {testingId === t.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCcw className="mr-1 h-3 w-3" />}
                  Test
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={() => removeTool(t.id)} aria-label="Remove tool">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="mt-4 grid gap-3 rounded-lg border border-border/70 bg-background/30 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as AgentTool["kind"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mcp">MCP server</SelectItem>
                    <SelectItem value="api">REST API</SelectItem>
                    <SelectItem value="plugin">Plugin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input placeholder="e.g. Weather API" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Endpoint URL</Label>
                <Input placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="font-mono text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Authorization header <span className="text-muted-foreground">(optional, e.g. Bearer sk-...)</span></Label>
              <Input value={form.authHeader} onChange={(e) => setForm({ ...form, authHeader: e.target.value })} className="font-mono text-xs" />
            </div>
            <Button onClick={addCustom} className="font-mono">
              <Plus className="mr-2 h-4 w-4" /> Register & arm
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
