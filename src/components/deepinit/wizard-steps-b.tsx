"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useDeepInit } from "@/lib/store";
import type { AIProvider, MessagingChannel, Questionnaire } from "@/lib/types";
import { Check, Clock, Cpu, KeyRound, Sparkles, User } from "lucide-react";
import { useState } from "react";
import { CopyField, MonoLabel, Panel, StatusDot } from "./ui-bits";

export const GOALS = [
  "Research & briefings",
  "Email & messaging",
  "Calendar & reminders",
  "Coding & DevOps",
  "Data & reports",
  "Shopping & orders",
  "Social media",
  "Finance & invoices",
  "Home & IoT",
  "Everything — full autonomy",
];

export const LANGUAGES = ["English", "中文", "Español", "Français", "Deutsch", "العربية", "Português", "Русский", "日本語"];

export function StepQuestionnaire({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const q = useDeepInit((s) => s.questionnaire);
  const setQ = useDeepInit((s) => s.setQuestionnaire);

  const toggleGoal = (g: string) => {
    const goals = q.goals.includes(g) ? q.goals.filter((x) => x !== g) : [...q.goals, g];
    setQ({ goals });
  };

  return (
    <div className="space-y-6">
      <div>
        <MonoLabel className="mb-2">{`/// step 4 of 5 — shaping your agent`}</MonoLabel>
        <h2 className="text-2xl font-bold tracking-tight">Tell it how to work for you</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Six quick answers. The agent builds its own operating instructions from these — and keeps learning past them.
        </p>
      </div>

      {/* goals */}
      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">1 · What should it focus on first?</Label>
          <span className="font-mono text-[11px] text-muted-foreground">{q.goals.length} selected</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {GOALS.map((g) => {
            const on = q.goals.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggleGoal(g)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  on
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {on && <Check className="h-3 w-3 text-primary" />}
                {g}
              </button>
            );
          })}
        </div>
      </Panel>

      {/* autonomy */}
      <Panel className="p-5">
        <Label className="text-sm font-semibold">2 · How much freedom does it get?</Label>
        <RadioGroup
          className="mt-3 gap-3"
          value={q.autonomy}
          onValueChange={(v) => setQ({ autonomy: v as Questionnaire["autonomy"] })}
        >
          {(
            [
              { v: "supervised", t: "Ask me first", d: "Every real-world action needs your approval." },
              { v: "suggested", t: "Suggest, then act", d: "It says what it will do, then does it unless you object." },
              { v: "full", t: "Full autonomy", d: "It acts on its own and reports afterwards. Maximum 24/7 power." },
            ] as const
          ).map((o) => (
            <Label
              key={o.v}
              htmlFor={`auto-${o.v}`}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                q.autonomy === o.v ? "border-primary/60 bg-primary/10" : "border-border hover:border-primary/30"
              }`}
            >
              <RadioGroupItem id={`auto-${o.v}`} value={o.v} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{o.t}</span>
                <span className="block text-xs text-muted-foreground">{o.d}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </Panel>

      {/* personality + schedule + language */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <Label className="text-sm font-semibold">3 · Personality</Label>
          <Select value={q.personality} onValueChange={(v) => setQ({ personality: v as Questionnaire["personality"] })}>
            <SelectTrigger className="mt-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="concise">Concise & professional</SelectItem>
              <SelectItem value="friendly">Friendly chief-of-staff</SelectItem>
              <SelectItem value="technical">Technical & detailed</SelectItem>
              <SelectItem value="playful">Playful & witty</SelectItem>
            </SelectContent>
          </Select>
        </Panel>

        <Panel className="p-5">
          <Label className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" /> 4 · Active hours
          </Label>
          <RadioGroup
            className="mt-3 gap-2"
            value={q.schedule}
            onValueChange={(v) => setQ({ schedule: v as Questionnaire["schedule"] })}
          >
            {(
              [
                { v: "247", t: "24/7 — always on" },
                { v: "workhours", t: "Work hours only" },
                { v: "custom", t: "Custom" },
              ] as const
            ).map((o) => (
              <Label key={o.v} htmlFor={`sched-${o.v}`} className="flex cursor-pointer items-center gap-3 text-sm">
                <RadioGroupItem id={`sched-${o.v}`} value={o.v} />
                {o.t}
              </Label>
            ))}
          </RadioGroup>
          {q.schedule !== "247" && (
            <Input
              className="mt-3 font-mono text-xs"
              placeholder={q.schedule === "workhours" ? "Mon–Fri, 09:00–18:00" : "e.g. 21:00–09:00, weekends off"}
              value={q.customHours}
              onChange={(e) => setQ({ customHours: e.target.value })}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <Label className="text-sm font-semibold">5 · Preferred language</Label>
          <Select value={q.language} onValueChange={(v) => setQ({ language: v })}>
            <SelectTrigger className="mt-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Panel>
        <Panel className="p-5">
          <Label className="text-sm font-semibold">6 · Anything it should know about you?</Label>
          <Textarea
            className="mt-3 min-h-[88px] text-sm"
            placeholder="Job, projects, tools you use, pet peeves, people it may contact..."
            value={q.notes}
            onChange={(e) => setQ({ notes: e.target.value })}
          />
        </Panel>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="font-mono">← Back</Button>
        <Button
          onClick={onNext}
          className="font-mono"
          disabled={q.goals.length === 0}
        >
          {q.goals.length === 0 ? "Pick at least one focus" : "Review & initialize →"}
        </Button>
      </div>
    </div>
  );
}

export function StepReview({ onBack, onInitialize }: { onBack: () => void; onInitialize: () => void }) {
  const profile = useDeepInit((s) => s.profile);
  const channels = useDeepInit((s) => s.channels);
  const providers = useDeepInit((s) => s.providers);
  const q = useDeepInit((s) => s.questionnaire);
  const tools = useDeepInit((s) => s.tools);

  const sorted = [...providers].sort((a, b) => a.priority - b.priority);
  const connected = channels.filter((c) => c.status === "connected");
  const enabledTools = tools.filter((t) => t.enabled).length;

  return (
    <div className="space-y-6">
      <div>
        <MonoLabel className="mb-2">{`/// step 5 of 5 — final check`}</MonoLabel>
        <h2 className="text-2xl font-bold tracking-tight">Everything is set. Initialize?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hit the switch and the agent boots into its 24/7 loop. Everything below stays editable later.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <MonoLabel>operator</MonoLabel>
          </div>
          <div className="mt-3 space-y-1.5 text-sm">
            <div><span className="text-muted-foreground">Name:</span> {profile.displayName}</div>
            <div><span className="text-muted-foreground">Agent:</span> <span className="font-mono text-primary">{profile.agentName}</span></div>
            <div><span className="text-muted-foreground">Timezone:</span> <span className="font-mono">{profile.timezone}</span></div>
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            <MonoLabel>brains — fallback chain</MonoLabel>
          </div>
          <div className="mt-3 space-y-2">
            {sorted.length === 0 && (
              <p className="text-sm text-muted-foreground">No custom providers — the demo brain will carry the agent.</p>
            )}
            {sorted.map((p, i) => (
              <ProviderLine key={p.id} p={p} index={i} last={i === sorted.length - 1} />
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <MonoLabel>messengers</MonoLabel>
          <div className="mt-3 space-y-2">
            {connected.length === 0 && (
              <p className="text-sm text-muted-foreground">Not wired yet — you can pair Telegram later in the console.</p>
            )}
            {connected.map((c) => (
              <ChannelLine key={c.id} c={c} />
            ))}
          </div>
        </Panel>

        <Panel className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <MonoLabel>access credentials — generated for you, save them</MonoLabel>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <CopyField label="portal username" value={profile.portalUser || "—"} />
            <CopyField label="portal token" value={profile.portalToken || "—"} />
            <CopyField label="channel pairing token" value={profile.pairingToken || "—"} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The username + token unlock this web portal on any device (you&apos;ll be asked for them next visit). The
            pairing token goes to your Telegram bot — send it as a message to start chatting. Both were generated
            during this wizard and live only in this browser until you save them.
          </p>
        </Panel>

        <Panel className="p-5">
          <MonoLabel>directives</MonoLabel>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {q.goals.map((g) => (
                <Badge key={g} variant="outline" className="text-[11px]">{g}</Badge>
              ))}
            </div>
            <div className="text-muted-foreground">
              Autonomy: <span className="text-foreground">{q.autonomy === "full" ? "Full autonomy" : q.autonomy === "suggested" ? "Suggest, then act" : "Ask me first"}</span>
              {" · "}Active: <span className="text-foreground">{q.schedule === "247" ? "24/7" : q.customHours || q.schedule}</span>
              {" · "}Language: <span className="text-foreground">{q.language}</span>
            </div>
            <div className="text-muted-foreground">
              Tools enabled: <span className="font-mono text-foreground">{enabledTools}/{tools.length}</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="font-mono">← Back</Button>
        <Button onClick={onInitialize} size="lg" className="di-glow font-mono">
          <Sparkles className="mr-2 h-4 w-4" /> sudo init --agent
        </Button>
      </div>
    </div>
  );
}

export function ProviderLine({ p, index, last, arrow }: { p: AIProvider; index: number; last?: boolean; arrow?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="font-mono text-[10px] text-muted-foreground">#{index + 1}</span>
        <StatusDot ok={p.lastStatus !== "error"} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.label}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{p.model}</div>
        </div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{arrow ?? (last ? "last resort" : `→ #${index + 2}`)}</span>
    </div>
  );
}

export function ChannelLine({ c }: { c: MessagingChannel }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <StatusDot ok={c.status === "connected"} />
        <div>
          <div className="text-sm font-medium capitalize">{c.type}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{c.handle || c.label}</div>
        </div>
      </div>
      <Badge variant="outline" className="font-mono text-[10px] text-primary">linked</Badge>
    </div>
  );
}
