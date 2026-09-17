"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { buildSystemPrompt, genPairingToken, uid, useDeepInit } from "@/lib/store";
import type { GatewayStatus, WhitelistUser } from "@/lib/types";
import {
  Loader2,
  PlugZap,
  RadioTower,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopyField, MonoLabel, Panel, StatusDot } from "./ui-bits";

const MODE_INFO: Record<WhitelistUser["mode"], string> = {
  shared: "shares the agent's memory & context with you",
  isolated: "gets a private, self-contained thread",
};

/* ============================================================
 * Access whitelist — every entry gets its own pairing token.
 * The owner token (profile.pairingToken) is handled separately.
 * ============================================================ */

export function WhitelistPanel({ boundTokens }: { boundTokens: string[] }) {
  const whitelist = useDeepInit((s) => s.whitelist);
  const profile = useDeepInit((s) => s.profile);
  const addWhitelistUser = useDeepInit((s) => s.addWhitelistUser);
  const removeWhitelistUser = useDeepInit((s) => s.removeWhitelistUser);

  const [name, setName] = useState("");
  const [mode, setMode] = useState<WhitelistUser["mode"]>("shared");

  const add = () => {
    if (!name.trim()) return;
    // unique token across owner + existing entries
    let token = genPairingToken();
    const taken = new Set([profile.pairingToken, ...whitelist.map((w) => w.token)].map((t) => (t || "").toUpperCase()));
    while (taken.has(token.toUpperCase())) token = genPairingToken();
    addWhitelistUser({
      id: uid(),
      name: name.trim(),
      mode,
      token,
      createdAt: new Date().toISOString(),
    });
    setName("");
    // push the expanded whitelist to the gateway
    setTimeout(() => window.dispatchEvent(new Event("di-resync")), 120);
  };

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between border-b border-border/70 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <MonoLabel>access whitelist — let others chat with your bot</MonoLabel>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">{whitelist.length} user{whitelist.length === 1 ? "" : "s"}</span>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Hand a token to a friend or teammate: they open the bot, send the token, get a{" "}
        <span className="font-mono text-foreground">Paired ✓</span> reply and start chatting. You choose whether each
        person shares your agent&apos;s memory and context or works in a fully isolated thread.
      </p>

      {/* add form */}
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="wl-name" className="sr-only">Name</Label>
          <Input
            id="wl-name"
            placeholder="Person's name — e.g. Dana"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
        </div>
        <Select value={mode} onValueChange={(v) => setMode(v as WhitelistUser["mode"])}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shared">Shared context</SelectItem>
            <SelectItem value="isolated">Isolated context</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={add} disabled={!name.trim()} className="font-mono">
          <UserPlus className="mr-2 h-4 w-4" /> Add user
        </Button>
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        {mode === "shared" ? MODE_INFO.shared : MODE_INFO.isolated}
      </p>

      {/* entries */}
      <div className="mt-4 space-y-3">
        {/* owner */}
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-medium">
                  {profile.displayName || "Owner"} <span className="font-mono text-[10px] text-primary">· owner</span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">full access · shared context</div>
              </div>
            </div>
            <span className={`font-mono text-[10px] ${boundTokens.includes((profile.pairingToken || "").toUpperCase()) ? "text-primary" : "text-muted-foreground"}`}>
              {boundTokens.includes((profile.pairingToken || "").toUpperCase()) ? "bound ✓" : "not bound"}
            </span>
          </div>
          <CopyField className="mt-2" label="owner token" value={profile.pairingToken || "—"} />
        </div>

        {whitelist.map((w) => {
          const bound = boundTokens.includes(w.token.toUpperCase());
          return (
            <div key={w.id} className="rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusDot ok={bound} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{w.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {w.mode} context {bound ? "· bound ✓" : "· awaiting token"}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-red-400 hover:text-red-300"
                  aria-label={`Remove ${w.name}`}
                  onClick={() => {
                    removeWhitelistUser(w.id);
                    window.dispatchEvent(new Event("di-resync"));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <CopyField className="mt-2" label={`${w.name}'s token`} value={w.token} />
            </div>
          );
        })}

        {whitelist.length === 0 && (
          <p className="py-2 text-center font-mono text-[11px] text-muted-foreground">
            no extra users yet — the owner token above is all you need
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ============================================================
 * Gateway status — bound chats, recent replies, resync + poll bridge
 * ============================================================ */

export function GatewayPanel({
  sessionKey,
  onBoundTokens,
}: {
  sessionKey?: string;
  onBoundTokens: (tokens: string[]) => void;
}) {
  const profile = useDeepInit((s) => s.profile);
  const providers = useDeepInit((s) => s.providers);
  const whitelist = useDeepInit((s) => s.whitelist);
  const channels = useDeepInit((s) => s.channels);
  const tools = useDeepInit((s) => s.tools);
  const instances = useDeepInit((s) => s.instances);
  const tunnels = useDeepInit((s) => s.tunnels);
  const skills = useDeepInit((s) => s.skills);
  const updateChannel = useDeepInit((s) => s.updateChannel);
  const logActivity = useDeepInit((s) => s.logActivity);
  const { toast } = useToast();

  const telegram = channels.find((c) => c.type === "telegram");
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [bridge, setBridge] = useState(false);
  const [bridgeTick, setBridgeTick] = useState(0);
  const modeRef = useRef<string | null>(telegram?.gatewayMode || null);

  const resync = useCallback(async () => {
    if (!telegram) return;
    setSyncing(true);
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
          mode: telegram.builtIn === false ? "own" : "builtin",
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
        if (telegram.id) {
          updateChannel(telegram.id, {
            sessionKey: data.sessionKey,
            gatewayMode: data.gatewayMode,
            handle: `@${data.bot.username}`,
          });
        }
        modeRef.current = data.gatewayMode;
        logActivity({ kind: "channel", title: "Gateway resynced", detail: `@${data.bot.username} · ${data.gatewayMode} mode` });
        toast({ title: "Gateway resynced", description: `Brains + whitelist pushed (${data.gatewayMode} mode).` });
      } else {
        toast({ title: "Resync failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Resync failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [telegram, logActivity, toast, updateChannel]);

  /* status poll — every 8s while the tab shows this panel */
  const lastAutoResync = useRef(0);
  useEffect(() => {
    if (!sessionKey) {
      setStatus(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/telegram/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: sessionKey }),
        });
        const data = (await res.json()) as GatewayStatus & { ok: boolean };
        if (!alive) return;
        setStatus(data);
        onBoundTokens(data.boundTokens || []);
        // self-heal: if the shared registry lost this session (blob race,
        // cold start, redeploy), push the config again — throttled to 60s
        if (data.ok && !data.registered && Date.now() - lastAutoResync.current > 60_000) {
          lastAutoResync.current = Date.now();
          window.dispatchEvent(new Event("di-resync"));
        }
      } catch {
        /* offline — keep last status */
      }
    };
    tick();
    const iv = setInterval(tick, 8_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [sessionKey, whitelist.length, profile.pairingToken, onBoundTokens]);

  /* resync — keeps the server-side runtime config fresh (brains, whitelist) */
  const resyncRef = useRef(resync);
  resyncRef.current = resync;
  useEffect(() => {
    const onEvent = () => resyncRef.current();
    window.addEventListener("di-resync", onEvent);
    return () => window.removeEventListener("di-resync", onEvent);
  }, []);

  // heal cold instances: resync shortly after mount + every 4 minutes
  useEffect(() => {
    if (!telegram) return;
    const first = setTimeout(() => resyncRef.current(), 1_200);
    const iv = setInterval(() => resyncRef.current(), 4 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [telegram]);

  /* poll bridge — browser-driven getUpdates loop (localhost / webhook-less setups) */
  useEffect(() => {
    if (!bridge || !sessionKey) return;
    let alive = true;
    const beat = async () => {
      try {
        const res = await fetch("/api/telegram/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: sessionKey }),
        });
        const data = await res.json();
        if (!alive) return;
        if (data.ok && data.processed > 0) {
          logActivity({
            kind: "message",
            title: `Telegram: ${data.processed} update${data.processed === 1 ? "" : "s"} processed`,
            detail: (data.replies || []).map((r: { preview: string }) => r.preview).join(" | ").slice(0, 140),
          });
          setBridgeTick((t) => t + 1);
        } else if (!data.ok && /webhook/i.test(String(data.error || ""))) {
          setBridge(false);
          toast({ title: "Webhook is active", description: "Polling bridge not needed — the gateway runs server-side." });
        }
      } catch {
        /* transient */
      }
    };
    beat();
    const iv = setInterval(beat, 4_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [bridge, sessionKey, logActivity, toast]);

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between border-b border-border/70 pb-3">
        <div className="flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-primary" />
          <MonoLabel>telegram gateway</MonoLabel>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <StatusDot ok={status?.registered ? true : telegram ? "warn" : false} />
          {status?.registered ? `live · ${status.chats.length} chat${status.chats.length === 1 ? "" : "s"}` : telegram ? "not synced" : "not paired"}
        </div>
      </div>

      {!telegram ? (
        <p className="mt-3 text-sm text-muted-foreground">Pair a bot above to see gateway status.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat label="bot" value={telegram.handle || "—"} />
            <MiniStat label="gateway" value={telegram.gatewayMode || "—"} />
            <MiniStat label="bound chats" value={String(status?.chats.length ?? 0)} />
          </div>

          {/* recent replies */}
          {status?.recentReplies?.length ? (
            <div className="di-scroll max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-border/70 bg-background/40 p-2.5 font-mono text-[11px]">
              {status.recentReplies.map((r, i) => (
                <div key={`${r.at}-${i}`} className="flex items-start gap-2">
                  <span className="shrink-0 text-primary">➤</span>
                  <span className="shrink-0 text-muted-foreground">chat {r.chatId}</span>
                  <span className="truncate text-foreground/85">{r.preview}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground">
              no replies yet — send the pairing token to the bot, then say hi
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="font-mono text-xs" onClick={resync} disabled={syncing}>
              {syncing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <PlugZap className="mr-1.5 h-3 w-3" />}
              Resync gateway
            </Button>
            <Button
              variant={bridge ? "default" : "outline"}
              size="sm"
              className="font-mono text-xs"
              onClick={() => setBridge((b) => !b)}
            >
              {bridge ? "Stop poll bridge" : "Run poll bridge"}
            </Button>
            {bridge && (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-primary">
                <StatusDot ok /> bridge live{bridgeTick > 0 ? ` · ${bridgeTick} handled` : " — waiting"}
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            webhook mode = server push (deployed portals, zero clicks). poll bridge = the portal fetches updates every
            4s while this tab is open (local dev). If the bot ever goes quiet after a server restart, hit Resync.
          </p>
        </div>
      )}
    </Panel>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}
