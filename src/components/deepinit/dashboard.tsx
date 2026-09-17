"use client";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDeepInit } from "@/lib/store";
import type { ActivityEvent } from "@/lib/types";
import { useT } from "@/lib/i18n";
import {
  Activity,
  Cable,
  Clock,
  HeartPulse,
  KeyRound,
  LogOut,
  MessageCircle,
  MessagesSquare,
  MonitorSmartphone,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CopyField, Logo, MonoLabel, Panel, StatusDot } from "./ui-bits";
import { AgentConsole } from "./agent-console";
import { BrainsPanel, ToolsPanel } from "./dashboard-panels";
import { InstancesPanel } from "./instances-panel";
import { GatewayPanel, WhitelistPanel } from "./channels-ops";
import { PresetsPanel } from "./presets-panel";
import { TelegramCard } from "./wizard";
import { LangSwitch } from "./lang-switch";

type Tab =
  | "overview"
  | "console"
  | "channels"
  | "presets"
  | "brains"
  | "tools"
  | "instances"
  | "activity";

const TABS: { id: Tab; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", icon: HeartPulse },
  { id: "console", icon: TerminalSquare },
  { id: "channels", icon: MessageCircle },
  { id: "presets", icon: Sparkles },
  { id: "brains", icon: Cable },
  { id: "tools", icon: Wrench },
  { id: "instances", icon: MonitorSmartphone },
  { id: "activity", icon: Activity },
];

const LOOP_TASKS = [
  "Heartbeat OK — all systems nominal",
  "Scanned connected inboxes — nothing urgent",
  "Checked calendar for upcoming conflicts",
  "Consolidated memory: new facts indexed",
  "Re-ranked task queue by priority",
  "Polled registered endpoints for changes",
  "Pruned stale skills from the registry",
  "Prepared proactive morning briefing",
];

function fmtUptime(fromMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  const d = Math.floor(s / 86400);
  const h = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return d > 0 ? `${d}d ${h}:${m}:${sec}` : `${h}:${m}:${sec}`;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function Dashboard({ onLogout }: { onLogout?: () => void }) {
  const profile = useDeepInit((s) => s.profile);
  const channels = useDeepInit((s) => s.channels);
  const providers = useDeepInit((s) => s.providers);
  const tools = useDeepInit((s) => s.tools);
  const messages = useDeepInit((s) => s.messages);
  const activity = useDeepInit((s) => s.activity);
  const questionnaire = useDeepInit((s) => s.questionnaire);
  const instances = useDeepInit((s) => s.instances);
  const tunnels = useDeepInit((s) => s.tunnels);
  const skills = useDeepInit((s) => s.skills);
  const activatedAt = useDeepInit((s) => s.activatedAt);
  const logActivity = useDeepInit((s) => s.logActivity);
  const resetAll = useDeepInit((s) => s.resetAll);
  const setView = useDeepInit((s) => s.setView);
  const t = useT();

  const [tab, setTab] = useState<Tab>("overview");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // autonomous loop — periodic heartbeat + task ticks
  useEffect(() => {
    const iv = setInterval(() => {
      const roll = Math.random();
      if (roll < 0.45) {
        logActivity({ kind: "heartbeat", title: `Heartbeat OK — ${profile.agentName} is on watch` });
      } else {
        const t = LOOP_TASKS[Math.floor(Math.random() * LOOP_TASKS.length)];
        logActivity({ kind: "task", title: t });
      }
    }, 16_000);
    return () => clearInterval(iv);
  }, [logActivity, profile.agentName]);

  const enabledProviders = useMemo(
    () => [...providers].filter((p) => p.enabled).sort((a, b) => a.priority - b.priority),
    [providers]
  );
  const connected = channels.filter((c) => c.status === "connected");
  const enabledTools = tools.filter((t) => t.enabled);
  const machinesLinked = instances.length + tunnels.filter((t) => t.status !== "pending").length;
  const tasksHandled = Math.floor(messages.length / 2);

  const uptime = activatedAt ? fmtUptime(new Date(activatedAt).getTime(), now) : "—";
  const cycles = activatedAt ? Math.floor((now - new Date(activatedAt).getTime()) / 16_000) : 0;

  const loopFeed = useMemo(
    () => activity.filter((e) => e.kind === "heartbeat" || e.kind === "task").slice(0, 9),
    [activity]
  );

  return (
    <div className="di-grid-bg flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <TerminalSquare className="h-5 w-5 shrink-0 text-primary" />
            <Logo className="shrink-0 text-base" />
            <span className="hidden h-4 w-px bg-border sm:block" />
            <span className="hidden truncate font-mono text-sm text-primary sm:block">{profile.agentName}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 font-mono text-[11px] text-muted-foreground md:inline-flex">
              <StatusDot ok /> {t("dash.activeUp", { uptime })}
            </span>
            <LangSwitch />
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={onLogout}
              aria-label="Log out of the portal"
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> {t("act.lock")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="font-mono text-xs">
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t("act.reset")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("dash.resetTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("dash.resetBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("dash.resetCancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={resetAll} className="font-mono">
                    {t("dash.resetConfirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* tabs */}
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6">
          <nav className="flex gap-1 pb-px" aria-label="Dashboard sections">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                aria-current={tab === tb.id ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 font-mono text-xs transition-colors ${
                  tab === tb.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <tb.icon className="h-3.5 w-3.5" />
                {t(`tab.${tb.id}`)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {tab === "overview" && (
          <div className="di-fade-up space-y-4">
            {/* stat cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard icon={<Clock className="h-4 w-4 text-primary" />} label={t("stat.uptime")} value={uptime} sub={activatedAt ? `since ${new Date(activatedAt).toLocaleString()}` : undefined} />
              <StatCard icon={<MessageCircle className="h-4 w-4 text-primary" />} label={t("stat.channels")} value={`${connected.length}/1`} sub={connected.length ? connected.map((c) => c.handle || c.type).join(" · ") : t("stat.notPaired")} />
              <StatCard icon={<Cable className="h-4 w-4 text-primary" />} label={t("stat.chain")} value={t("stat.brains", { n: enabledProviders.length, s: enabledProviders.length === 1 ? "" : "s" })} sub={enabledProviders.length ? t("stat.primary", { name: enabledProviders[0].label }) : t("stat.demoBrain")} />
              <StatCard icon={<Wrench className="h-4 w-4 text-primary" />} label={t("stat.tools")} value={`${enabledTools.length}/${tools.length}`} sub={t("stat.cycles", { n: cycles })} />
              <StatCard icon={<MonitorSmartphone className="h-4 w-4 text-primary" />} label={t("stat.machines")} value={`${machinesLinked}`} sub={machinesLinked ? t("stat.sshTunnel") : t("stat.pairInstances")} />
            </div>

            {/* loop + quick actions */}
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Panel className="p-5">
                <div className="flex items-center justify-between border-b border-border/70 pb-3">
                  <div className="flex items-center gap-2">
                    <HeartPulse className="h-4 w-4 text-primary" />
                    <MonoLabel>{t("loop.title", { agent: profile.agentName })}</MonoLabel>
                  </div>
                  <StatusDot ok />
                </div>
                <div className="di-scroll mt-3 max-h-72 space-y-2 overflow-y-auto font-mono text-xs">
                  {loopFeed.length === 0 && (
                    <p className="text-muted-foreground">{t("loop.warming")}</p>
                  )}
                  {loopFeed.map((e) => (
                    <div key={e.id} className="di-fade-up flex items-start gap-2">
                      <span className="text-primary">❯</span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className="text-foreground/85">{e.title}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <div className="space-y-4">
                <Panel className="p-5">
                  <MonoLabel>{t("missions.title")}</MonoLabel>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("missions.body", { agent: profile.agentName })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {questionnaire.goals.map((g) => (
                      <span key={g} className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px]">
                        {g}
                      </span>
                    ))}
                  </div>
                </Panel>

                <Panel className="p-5">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-primary" />
                    <MonoLabel>{t("portal.title")}</MonoLabel>
                  </div>
                  <div className="mt-3 space-y-2">
                    <CopyField label={t("pl.fUser")} value={profile.portalUser || "—"} />
                    <CopyField label={t("pl.fToken")} value={profile.portalToken || "—"} />
                    <CopyField label="channel pairing token" value={profile.pairingToken || "—"} />
                  </div>
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {t("portal.hint")}
                  </p>
                </Panel>

                <Panel className="p-5">
                <MonoLabel>{t("skills.title")}</MonoLabel>
                <div className="di-scroll mt-2 max-h-44 space-y-2 overflow-y-auto">
                  {skills.map((sk) => (
                    <div key={sk.id} className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs text-foreground">{sk.name}</span>
                        <span className={`shrink-0 font-mono text-[10px] ${sk.status === "armed" ? "text-primary" : "text-amber-400"}`}>
                          {sk.status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{sk.source}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{sk.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {t("skills.body")}
                </p>
              </Panel>
              </div>
            </div>
          </div>
        )}

        {tab === "console" && <AgentConsole />}

        {tab === "presets" && <div className="di-fade-up"><PresetsPanel /></div>}
        {tab === "channels" && (
          <ChannelsTab />
        )}

        {tab === "brains" && <div className="di-fade-up"><BrainsPanel /></div>}
        {tab === "tools" && <div className="di-fade-up"><ToolsPanel /></div>}
        {tab === "instances" && <div className="di-fade-up"><InstancesPanel /></div>}

        {tab === "activity" && (
          <div className="di-fade-up">
            <Panel className="p-5">
              <div className="flex items-center justify-between border-b border-border/70 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <MonoLabel>{t("actlog.title")}</MonoLabel>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{t("actlog.events", { n: activity.length })}</span>
              </div>
              <div className="di-scroll mt-3 max-h-[62vh] space-y-1 overflow-y-auto">
                {activity.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("actlog.empty")}</p>
                )}
                {activity.map((e) => (
                  <ActivityRow key={e.id} e={e} />
                ))}
              </div>
            </Panel>
          </div>
        )}
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 font-mono text-[11px] text-muted-foreground sm:flex-row sm:px-6">
          <span className="inline-flex items-center gap-1.5">
            <MessagesSquare className="h-3.5 w-3.5 text-primary" />
            {t("foot.tasks", { n: tasksHandled, s: tasksHandled === 1 ? "" : "s" })}
          </span>
          <button onClick={() => setView("landing")} className="hover:text-foreground">
            deep-init v1.0.0 · agent kernel
          </button>
        </div>
      </footer>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between">
        <MonoLabel>{label}</MonoLabel>
        {icon}
      </div>
      <div className="mt-2 font-mono text-xl font-bold tracking-tight text-foreground">{value}</div>
      {sub && <div className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </Panel>
  );
}

/* ---------------- channels tab ---------------- */

function ChannelsTab() {
  const channels = useDeepInit((s) => s.channels);
  const addChannel = useDeepInit((s) => s.addChannel);
  const logActivity = useDeepInit((s) => s.logActivity);
  const telegram = channels.find((c) => c.type === "telegram");
  const [boundTokens, setBoundTokens] = useState<string[]>([]);

  return (
    <div className="di-fade-up space-y-4">
      <TelegramCard
        channel={telegram}
        onPair={(c) => {
          addChannel(c);
          logActivity({ kind: "channel", title: "Telegram paired", detail: `${c.handle} · ${c.gatewayMode || "gateway"} mode` });
        }}
      />
      <GatewayPanel
        sessionKey={telegram?.sessionKey}
        onBoundTokens={setBoundTokens}
      />
      <WhitelistPanel boundTokens={boundTokens} />
    </div>
  );
}

const KIND_COLOR: Record<ActivityEvent["kind"], string> = {
  system: "text-primary",
  heartbeat: "text-primary/70",
  message: "text-emerald-400",
  channel: "text-amber-400",
  provider: "text-emerald-400",
  tool: "text-emerald-400",
  task: "text-foreground/80",
  error: "text-red-400",
};

function ActivityRow({ e }: { e: ActivityEvent }) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/40">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${KIND_COLOR[e.kind]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-snug">{e.title}</div>
        {e.detail && <div className="truncate font-mono text-[11px] text-muted-foreground">{e.detail}</div>}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timeAgo(e.at)}</span>
    </div>
  );
}
