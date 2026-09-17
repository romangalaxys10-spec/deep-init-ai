"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { uid, useDeepInit } from "@/lib/store";
import type { SSHInstance } from "@/lib/types";
import {
  Download,
  Laptop,
  Loader2,
  MonitorSmartphone,
  Plus,
  RefreshCcw,
  Server,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MonoLabel, Panel, StatusDot } from "./ui-bits";
import type { TunnelCommand } from "@/lib/types";

/* ================= SSH instances ================= */

export function SshSection() {
  const instances = useDeepInit((s) => s.instances);
  const addInstance = useDeepInit((s) => s.addInstance);
  const updateInstance = useDeepInit((s) => s.updateInstance);
  const removeInstance = useDeepInit((s) => s.removeInstance);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: "22",
    username: "root",
    auth: "password" as SSHInstance["auth"],
    password: "",
    privateKey: "",
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const credsOf = (i: SSHInstance) => ({
    host: i.host,
    port: i.port,
    username: i.username,
    auth: i.auth,
    password: i.password,
    privateKey: i.privateKey,
  });

  const test = async (i: SSHInstance) => {
    setBusyId(i.id);
    try {
      const res = await fetch("/api/instances/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credsOf(i)),
      });
      const data = await res.json();
      if (data.ok) {
        updateInstance(i.id, { status: "ok", sysinfo: data.sysinfo, lastError: undefined, lastCheckedAt: new Date().toISOString() });
        logActivity({ kind: "tool", title: `SSH link established: ${i.name}`, detail: data.message });
        toast({ title: `${i.name} connected`, description: data.message });
      } else {
        updateInstance(i.id, { status: "error", lastError: String(data.error).slice(0, 160), lastCheckedAt: new Date().toISOString() });
        logActivity({ kind: "error", title: `SSH failed: ${i.name}`, detail: String(data.error).slice(0, 120) });
        toast({ title: `${i.name} failed`, description: data.error, variant: "destructive" });
      }
    } finally {
      setBusyId(null);
    }
  };

  const exec = async (i: SSHInstance, command: string) => {
    setBusyId(i.id);
    try {
      const res = await fetch("/api/instances/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credsOf(i), command }),
      });
      const data = await res.json();
      return data.stdout || data.stderr || data.error || "(no output)";
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      setBusyId(null);
    }
  };

  const add = () => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      toast({ title: "Missing fields", description: "Name, host and username are required.", variant: "destructive" });
      return;
    }
    if (form.auth === "password" ? !form.password : !form.privateKey) {
      toast({ title: "Missing credentials", description: form.auth === "password" ? "Password required." : "Private key required.", variant: "destructive" });
      return;
    }
    addInstance({
      id: uid(),
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 22,
      username: form.username.trim(),
      auth: form.auth,
      password: form.auth === "password" ? form.password : undefined,
      privateKey: form.auth === "key" ? form.privateKey : undefined,
      status: "untested",
    });
    logActivity({ kind: "tool", title: `Instance registered: ${form.name.trim()}`, detail: `${form.username}@${form.host}:${form.port}` });
    setForm({ name: "", host: "", port: "22", username: "root", auth: "password", password: "", privateKey: "" });
    setShowForm(false);
    toast({ title: "Instance registered", description: "Test the connection, then the agent can run anything on it." });
  };

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <MonoLabel>ssh machines — direct control</MonoLabel>
        </div>
        <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => setShowForm((v) => !v)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add instance
        </Button>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Any Linux, macOS or BSD machine you can SSH into becomes an extension of the agent&apos;s own environment.
        The agent tests the link with <span className="font-mono text-foreground/80">uname · whoami · uptime</span> and then
        runs whatever a task needs on it.
      </p>

      <div className="mt-4 space-y-3">
        {instances.length === 0 && !showForm && (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No SSH instances yet. Add your VPS, home server or Mac.
          </p>
        )}

        {showForm && (
          <div className="grid gap-3 rounded-lg border border-border/70 bg-background/30 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input placeholder="Hetzner VPS" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Host</Label>
                <Input placeholder="203.0.113.10 or my.server.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Port</Label>
                  <Input placeholder="22" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">User</Label>
                  <Input placeholder="root" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="font-mono text-xs" />
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <div className="space-y-1.5">
                <Label className="text-xs">Auth</Label>
                <Select value={form.auth} onValueChange={(v) => setForm({ ...form, auth: v as SSHInstance["auth"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="key">Private key</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.auth === "password" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Password</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono text-xs" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">Private key (PEM)</Label>
                  <Textarea placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} className="min-h-[72px] font-mono text-[11px]" />
                </div>
              )}
            </div>
            <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldAlert className="h-3 w-3" /> Credentials stay in this browser and are sent only to execute your own commands.
            </p>
            <Button onClick={add} className="font-mono"><Plus className="mr-2 h-4 w-4" /> Register machine</Button>
          </div>
        )}

        {instances.map((i) => (
          <InstanceRow key={i.id} instance={i} busy={busyId === i.id} onTest={() => test(i)} onExec={(c) => exec(i, c)} onRemove={() => removeInstance(i.id)} />
        ))}
      </div>
    </Panel>
  );
}

function InstanceRow({
  instance,
  busy,
  onTest,
  onExec,
  onRemove,
}: {
  instance: SSHInstance;
  busy: boolean;
  onTest: () => void;
  onExec: (cmd: string) => Promise<string>;
  onRemove: () => void;
}) {
  const [cmd, setCmd] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!cmd.trim()) return;
    setRunning(true);
    setOutput(null);
    const out = await onExec(cmd.trim());
    setOutput(out || "(empty output)");
    setRunning(false);
  };

  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot ok={instance.status === "error" ? false : instance.status === "ok" ? true : "warn"} />
          <div className="min-w-0">
            <div className="text-sm font-medium">{instance.name}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {instance.username}@{instance.host}:{instance.port} · {instance.auth}
              {instance.sysinfo ? ` · ${instance.sysinfo.os} · ${instance.sysinfo.whoami}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 font-mono text-[11px]" onClick={onTest} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCcw className="mr-1 h-3 w-3" />}
            Test
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={onRemove} aria-label="Remove instance">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {instance.lastError && <p className="mt-2 font-mono text-[10px] text-red-400/80">{instance.lastError}</p>}

      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-xs text-primary">$</span>
        <Input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="run a command on this machine…"
          className="h-8 font-mono text-xs"
        />
        <Button size="sm" className="h-8 font-mono text-[11px]" onClick={run} disabled={running || !cmd.trim() || busy}>
          {running ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Zap className="mr-1 h-3 w-3" />}
          Run
        </Button>
      </div>
      {(running || output) && (
        <pre className="di-scroll mt-2 max-h-48 overflow-auto rounded-xl border border-border/60 bg-stone-900 p-3 font-mono text-[11px] leading-relaxed text-stone-100">
          {running ? "running…" : output}
        </pre>
      )}
    </div>
  );
}

/* ================= Tunnel machines ================= */

interface ScriptBundle {
  id: string;
  token: string;
  bash: string;
  powershell: string;
  quickstart: { linux_mac: string; windows: string };
}

export function TunnelSection() {
  const tunnels = useDeepInit((s) => s.tunnels);
  const updateTunnel = useDeepInit((s) => s.updateTunnel);
  const removeTunnel = useDeepInit((s) => s.removeTunnel);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [os, setOs] = useState("linux");
  const [bundle, setBundle] = useState<ScriptBundle | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tunnel/status", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        for (const m of data.machines as { id: string; status: string; hostname?: string; uptime?: string; sysinfo?: string; lastSeen?: string }[]) {
          updateTunnel(m.id, {
            status: m.status as "online" | "stale" | "pending",
            hostname: m.hostname,
            uptime: m.uptime,
            sysinfo: m.sysinfo,
            lastSeen: m.lastSeen,
          });
        }
      }
    } catch {
      /* relay unreachable — ignore */
    }
  }, [updateTunnel]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const register = async () => {
    if (!name.trim()) {
      toast({ title: "Name your machine first", variant: "destructive" });
      return;
    }
    const res = await fetch("/api/tunnel/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), os }),
    });
    const data = await res.json();
    if (data.ok) {
      setBundle(data);
      setScriptOpen(true);
      setShowForm(false);
      setName("");
    }
  };

  const runOnMachine = async (t: { id: string; token: string; name: string }) => {
    if (!cmd.trim()) return;
    setActiveId(t.id);
    setWaiting(true);
    setOutput(null);
    try {
      const res = await fetch("/api/tunnel/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, token: t.token, command: cmd.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setOutput(`Error: ${data.error}`);
        setWaiting(false);
        return;
      }
      const commandId = data.commandId;
      // poll for result up to ~30s
      let tries = 0;
      const poll = async () => {
        tries += 1;
        const r = await fetch(`/api/tunnel/command?id=${t.id}&token=${t.token}&commandId=${commandId}`, { cache: "no-store" });
        const rd = await r.json();
        if (rd.command && rd.command.status !== "queued") {
          setOutput(rd.command.result || "(empty output)");
          setWaiting(false);
          logActivity({ kind: "tool", title: `Tunnel command on ${t.name}`, detail: `$ ${cmd.trim().slice(0, 60)}` });
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (tries > 15) {
          setOutput("Timed out waiting for the machine — is the pair script still running?");
          setWaiting(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      };
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(poll, 2000);
    } catch (e) {
      setOutput(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setWaiting(false);
    }
  };

  const downloadScript = (b: ScriptBundle, shell: "bash" | "powershell") => {
    const url = `/api/tunnel/script?id=${b.id}&token=${b.token}&shell=${shell}`;
    window.open(url, "_blank");
  };

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-primary" />
          <MonoLabel>pair tunnel — no ssh needed</MonoLabel>
        </div>
        <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => setShowForm((v) => !v)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Pair a machine
        </Button>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        The Deep-init pair tunnel is a tiny script you run on any Linux, macOS or Windows (WSL / PowerShell) machine.
        It phones the gateway home every few seconds and executes whatever the agent queues — perfect when SSH ports
        are closed or the machine sits behind NAT.
      </p>

      {showForm && (
        <div className="mt-4 grid gap-3 rounded-lg border border-border/70 bg-background/30 p-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <Label className="text-xs">Machine name</Label>
              <Input placeholder="Home Rig / MacBook Pro / Hetzner VPS" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Script flavor</Label>
              <Select value={os} onValueChange={setOs}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="linux">Linux (bash)</SelectItem>
                  <SelectItem value="darwin">macOS (bash)</SelectItem>
                  <SelectItem value="windows">Windows / WSL (PowerShell)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={register} className="font-mono"><Zap className="mr-2 h-4 w-4" /> Generate pair plugin</Button>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {tunnels.length === 0 && !showForm && (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No paired machines yet. Generate the plugin and run it on yours.
          </p>
        )}
        {tunnels.map((t) => (
          <div key={t.id} className="rounded-lg border border-border/70 bg-background/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <StatusDot ok={t.status === "online" ? true : t.status === "stale" ? "warn" : false} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {t.status === "online" ? "online" : t.status === "stale" ? "stale" : "waiting for script"}
                    {t.hostname ? ` · ${t.hostname}` : ""}
                    {t.sysinfo ? ` · ${t.sysinfo}` : ""}
                    {t.uptime ? ` · ${t.uptime}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {bundle && bundle.id === t.id && (
                  <Button variant="outline" size="sm" className="h-8 font-mono text-[11px]" onClick={() => { setBundle(bundle); setScriptOpen(true); }}>
                    <TerminalSquare className="mr-1 h-3 w-3" /> Script
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" onClick={() => { removeTunnel(t.id); logActivity({ kind: "channel", title: `Machine unpaired: ${t.name}` }); }} aria-label="Unpair">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {t.status !== "pending" && (
              <div className="mt-3 flex items-center gap-2">
                <span className="font-mono text-xs text-primary">$</span>
                <Input
                  value={activeId === t.id && output !== null ? cmd : cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runOnMachine(t)}
                  placeholder="run a command on this machine via tunnel…"
                  className="h-8 font-mono text-xs"
                  disabled={false}
                />
                <Button size="sm" className="h-8 font-mono text-[11px]" onClick={() => runOnMachine(t)} disabled={waiting || !cmd.trim()}>
                  {waiting && activeId === t.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Zap className="mr-1 h-3 w-3" />}
                  Run
                </Button>
              </div>
            )}
            {(waiting || (output !== null && activeId === t.id)) && (
              <pre className="di-scroll mt-2 max-h-48 overflow-auto rounded-xl border border-border/60 bg-stone-900 p-3 font-mono text-[11px] leading-relaxed text-stone-100">
                {waiting && activeId === t.id ? "waiting for machine…" : output}
              </pre>
            )}
          </div>
        ))}
      </div>

      <ScriptDialog open={scriptOpen} onOpenChange={setScriptOpen} bundle={bundle} onDownload={downloadScript} />
    </Panel>
  );
}

function ScriptDialog({
  open,
  onOpenChange,
  bundle,
  onDownload,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bundle: ScriptBundle | null;
  onDownload: (b: ScriptBundle, shell: "bash" | "powershell") => void;
}) {
  if (!bundle) return null;
  const copy = (text: string) => navigator.clipboard?.writeText(text);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-mono">Pair plugin generated</DialogTitle>
          <DialogDescription>
            Run this once on your machine — it pairs instantly and stays connected. Anyone holding this script can run
            commands on that machine, so keep it private.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="bash" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="bash" className="font-mono text-xs">Linux / macOS (bash)</TabsTrigger>
            <TabsTrigger value="powershell" className="font-mono text-xs">Windows / WSL (PowerShell)</TabsTrigger>
          </TabsList>
          <TabsContent value="bash" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <code className="di-scroll overflow-x-auto rounded-full bg-stone-900 px-3 py-1 font-mono text-[10px] text-orange-200">
                curl -fsSL &quot;…/api/tunnel/script?id={bundle.id}&amp;token={bundle.token}&quot; | bash
              </code>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="outline" className="font-mono text-[11px]" onClick={() => copy(bundle.bash)}>Copy</Button>
                <Button size="sm" variant="outline" className="font-mono text-[11px]" onClick={() => onDownload(bundle, "bash")}>
                  <Download className="mr-1 h-3 w-3" /> .sh
                </Button>
              </div>
            </div>
            <pre className="di-scroll max-h-[42vh] overflow-auto rounded-xl border border-border/60 bg-stone-900 p-3 font-mono text-[10.5px] leading-relaxed text-stone-100">
              {bundle.bash}
            </pre>
          </TabsContent>
          <TabsContent value="powershell" className="space-y-2">
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="outline" className="font-mono text-[11px]" onClick={() => copy(bundle.powershell)}>Copy</Button>
              <Button size="sm" variant="outline" className="font-mono text-[11px]" onClick={() => onDownload(bundle, "powershell")}>
                <Download className="mr-1 h-3 w-3" /> .ps1
              </Button>
            </div>
            <pre className="di-scroll max-h-[42vh] overflow-auto rounded-xl border border-border/60 bg-stone-900 p-3 font-mono text-[10.5px] leading-relaxed text-stone-100">
              {bundle.powershell}
            </pre>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function InstancesPanel() {
  return (
    <div className="space-y-4">
      <TunnelSection />
      <SshSection />
      <Panel className="p-5">
        <div className="flex items-center gap-2">
          <Laptop className="h-4 w-4 text-primary" />
          <MonoLabel>routing rule</MonoLabel>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Anything the agent can&apos;t do inside its own cloud environment — opening your local files, driving desktop
          apps, using hardware, reaching LAN-only services — is automatically routed to a paired machine over SSH or the
          tunnel, executed there, and reported back. That&apos;s what makes it a full 24/7 operator on{" "}
          <span className="text-foreground">your</span> computers, not just in a browser tab.
        </p>
      </Panel>
    </div>
  );
}

export type { TunnelCommand };
