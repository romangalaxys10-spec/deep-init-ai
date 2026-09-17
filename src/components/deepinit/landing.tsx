"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
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
import { LangSwitch } from "./lang-switch";

const BOOT_LINES = [
  "deep-init v1.0.0 — agent kernel loading...",
  "mounting capability modules: web, fs, code, mail, vision",
  "scanning MCP registry .............. 42 servers found",
  "linking messengers: telegram ✔ own-bot support ✔",
  "provider fallback chain: primary → backup → demo brain",
  "self-learning loop: ON  ·  heartbeat every 60s",
  "agent ONLINE — awaiting initialization",
];

const CAPABILITIES = [
  { icon: Clock, titleKey: "cap1.title", bodyKey: "cap1.body" },
  { icon: TerminalSquare, titleKey: "cap2.title", bodyKey: "cap2.body" },
  { icon: Plug2, titleKey: "cap3.title", bodyKey: "cap3.body" },
  { icon: BrainCircuit, titleKey: "cap4.title", bodyKey: "cap4.body" },
  { icon: RefreshCcw, titleKey: "cap5.title", bodyKey: "cap5.body" },
  { icon: MessageCircle, titleKey: "cap6.title", bodyKey: "cap6.body" },
];

const STEPS = [
  { n: "01", icon: MessageCircle, titleKey: "how.s1.title", bodyKey: "how.s1.body" },
  { n: "02", icon: Plug2, titleKey: "how.s2.title", bodyKey: "how.s2.body" },
  { n: "03", icon: Sparkles, titleKey: "how.s3.title", bodyKey: "how.s3.body" },
  { n: "04", icon: Bot, titleKey: "how.s4.title", bodyKey: "how.s4.body" },
];

export function Landing({ onInitialize }: { onInitialize: () => void }) {
  const t = useT();
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
            <LangSwitch />
            <Button onClick={onInitialize} size="sm" className="font-mono tracking-wide">
              {t("nav.cta")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* hero */}
        <section className="grid items-center gap-10 py-16 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="di-fade-up">
            <MonoLabel className="mb-4">{t("hero.kicker")}</MonoLabel>
            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              {t("hero.titleA")}{" "}
              <span className="text-primary di-text-glow">{t("hero.titleB")}</span>.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("hero.sub")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button onClick={onInitialize} size="lg" className="font-mono">
                <Sparkles className="mr-2 h-4 w-4" /> {t("hero.cta1")}
              </Button>
              <Button asChild variant="outline" size="lg" className="font-mono">
                <a href="#how">{t("hero.cta2")}</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" /> {t("hero.f1")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-primary" /> {t("hero.f2")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" /> {t("hero.f3")}
              </span>
            </div>
          </div>

          <Panel glow className="di-scanline relative di-fade-up p-5 sm:p-6" >
            <div className="mb-4 flex items-center justify-between border-b border-border/70 pb-3">
              <MonoLabel>{t("panel.boot")}</MonoLabel>
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              </div>
            </div>
            <BootLog lines={BOOT_LINES} speed={520} className="min-h-[190px]" />
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/70 pt-4 font-mono text-[11px] text-muted-foreground">
              <div>
                <div className="text-foreground">{t("panel.kernel")}</div>
                <div className="text-primary">{t("panel.active")}</div>
              </div>
              <div>
                <div className="text-foreground">{t("panel.fallback")}</div>
                <div className="text-primary">{t("panel.armed")}</div>
              </div>
              <div>
                <div className="text-foreground">{t("panel.memory")}</div>
                <div className="text-primary">{t("panel.persistent")}</div>
              </div>
            </div>
          </Panel>
        </section>

        {/* capabilities */}
        <section id="capabilities" className="py-14 sm:py-20">
          <MonoLabel className="mb-3">{t("cap.kicker")}</MonoLabel>
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            {t("cap.title")}
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <Panel key={c.titleKey} className="group p-5 transition-colors hover:border-primary/40">
                <c.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 font-semibold leading-snug">{t(c.titleKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(c.bodyKey)}</p>
              </Panel>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="py-14 sm:py-20">
          <MonoLabel className="mb-3">{t("how.kicker")}</MonoLabel>
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            {t("how.title")}
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <Panel key={s.n} className="p-5">
                <div className="flex items-center justify-between">
                  <s.icon className="h-5 w-5 text-primary" />
                  <span className="font-mono text-xs text-muted-foreground">{s.n}</span>
                </div>
                <h3 className="mt-3 font-semibold leading-snug">{t(s.titleKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(s.bodyKey)}</p>
              </Panel>
            ))}
          </div>
          <div className="mt-10 flex justify-center">
            <Button onClick={onInitialize} size="lg" className="font-mono">
              <Send className="mr-2 h-4 w-4" /> {t("how.cta")}
            </Button>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 font-mono text-xs text-muted-foreground sm:flex-row sm:px-6">
          <Logo className="text-sm" />
          <span>{t("footer.tag")}</span>
          <span className="text-[11px]">
            made using <span className="text-primary">GLM 5.3 FLASH</span> · by Roman ·{" "}
            <a href="https://www.rommark.dev" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              www.rommark.dev
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
