"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  BrainCircuit,
  Clock,
  MessageCircle,
  Plug2,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { BootLog, Logo, MonoLabel, Panel } from "./ui-bits";

const BOOT_LINES = [
  "deep-init v1.0.0 — agent kernel loading...",
  "mounting capability modules: web, fs, code, mail, vision",
  "scanning MCP registry .............. 42 servers found",
  "linking messengers: whatsapp ✔ telegram ✔",
  "provider fallback chain: primary → backup → demo brain",
  "self-learning loop: ON  ·  heartbeat every 60s",
  "agent ONLINE — awaiting initialization",
];

const CAPABILITIES = [
  {
    icon: Clock,
    title: "Runs 24/7, never sleeps",
    body: "A persistent loop on your machine with heartbeats, schedules and self-wakeups. It works while you don't.",
  },
  {
    icon: TerminalSquare,
    title: "Anything a human can do on a computer",
    body: "Browses, clicks, types, reads and writes files, runs code, fills forms — full computer-use across apps and OS.",
  },
  {
    icon: Plug2,
    title: "Any MCP / API / plugin — self-wired",
    body: "Point it at any MCP server, REST endpoint or plugin. If a tool doesn't exist, it builds one and registers it.",
  },
  {
    icon: BrainCircuit,
    title: "Self-learning, self-creating",
    body: "Every task feeds long-term memory. It writes its own skills, prompts and automations and reuses them forever.",
  },
  {
    icon: RefreshCcw,
    title: "Multi-provider fallback",
    body: "Connect OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Ollama — anything. If one fails, the next brain takes over mid-task.",
  },
  {
    icon: MessageCircle,
    title: "Lives in WhatsApp & Telegram",
    body: "Pair your messenger once and command your agent from anywhere. It reports back proactively, day and night.",
  },
];

const STEPS = [
  {
    n: "01",
    icon: MessageCircle,
    title: "Pair your messengers",
    body: "WhatsApp via a one-time pairing code, Telegram via your @BotFather token — verified live.",
  },
  {
    n: "02",
    icon: Plug2,
    title: "Connect your AI providers",
    body: "Add any OpenAI-compatible or Anthropic endpoint with key + model. Order them into a fallback chain.",
  },
  {
    n: "03",
    icon: Sparkles,
    title: "Answer a friendly wizard",
    body: "Six quick questions shape your agent's goals, personality, autonomy and active hours.",
  },
  {
    n: "04",
    icon: Bot,
    title: "Initialize. It takes over.",
    body: "The agent boots, mounts your tools and starts its 24/7 loop. Watch everything live in the console.",
  },
];

export function Landing({ onInitialize }: { onInitialize: () => void }) {
  return (
    <div className="di-grid-bg min-h-screen">
      {/* nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <TerminalSquare className="h-5 w-5 text-primary" />
            <Logo className="text-lg" />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden font-mono text-[10px] tracking-widest text-muted-foreground sm:inline-flex">
              v1.0.0 · agent kernel
            </Badge>
            <Button onClick={onInitialize} size="sm" className="font-mono tracking-wide">
              Initialize agent
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* hero */}
        <section className="grid items-center gap-10 py-16 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="di-fade-up">
            <MonoLabel className="mb-4">{`/// autonomous personal agent`}</MonoLabel>
            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Your computer just hired a{" "}
              <span className="text-primary di-text-glow">full-time agent</span>.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Deep-init AI is a 24/7 personal assistant that can do anything a human can do
              on a computer — find, create, fetch, wire up any MCP / API / endpoint / plugin,
              learn new skills and even create its own. You talk to it on WhatsApp or Telegram.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button onClick={onInitialize} size="lg" className="font-mono">
                <Sparkles className="mr-2 h-4 w-4" /> Initialize your agent
              </Button>
              <Button asChild variant="outline" size="lg" className="font-mono">
                <a href="#how">How it works</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" /> your keys stay with you
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-primary" /> BYO providers & MCP
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" /> uptime loop 24/7
              </span>
            </div>
          </div>

          <Panel glow className="di-scanline relative di-fade-up p-5 sm:p-6" >
            <div className="mb-4 flex items-center justify-between border-b border-border/70 pb-3">
              <MonoLabel>boot sequence</MonoLabel>
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-primary/80" />
              </div>
            </div>
            <BootLog lines={BOOT_LINES} speed={520} className="min-h-[190px]" />
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/70 pt-4 font-mono text-[11px] text-muted-foreground">
              <div>
                <div className="text-foreground">kernel</div>
                <div className="text-primary">active</div>
              </div>
              <div>
                <div className="text-foreground">fallback</div>
                <div className="text-primary">armed</div>
              </div>
              <div>
                <div className="text-foreground">memory</div>
                <div className="text-primary">persistent</div>
              </div>
            </div>
          </Panel>
        </section>

        {/* capabilities */}
        <section id="capabilities" className="py-14 sm:py-20">
          <MonoLabel className="mb-3">{`/// capability matrix`}</MonoLabel>
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            Not a chatbot. A full-time operator.
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <Panel key={c.title} className="group p-5 transition-colors hover:border-primary/40">
                <c.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 font-semibold leading-snug">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
              </Panel>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="py-14 sm:py-20">
          <MonoLabel className="mb-3">{`/// init sequence`}</MonoLabel>
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            From zero to autonomous in four steps.
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <Panel key={s.n} className="p-5">
                <div className="flex items-center justify-between">
                  <s.icon className="h-5 w-5 text-primary" />
                  <span className="font-mono text-xs text-muted-foreground">{s.n}</span>
                </div>
                <h3 className="mt-3 font-semibold leading-snug">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </Panel>
            ))}
          </div>
          <div className="mt-10 flex justify-center">
            <Button onClick={onInitialize} size="lg" className="font-mono">
              <Send className="mr-2 h-4 w-4" /> Start the wizard
            </Button>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 font-mono text-xs text-muted-foreground sm:flex-row sm:px-6">
          <Logo className="text-sm" />
          <span>runs on your machine · your keys · your data</span>
        </div>
      </footer>
    </div>
  );
}
