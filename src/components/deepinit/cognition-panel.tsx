"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { BRAINS, brainSignature, type BrainId } from "@/lib/brains";
import { useDeepInit } from "@/lib/store";
import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { MonoLabel, Panel } from "./ui-bits";

/* ============================================================
 * CognitionPanel — cognition packs toggles (Hermes / Moltis).
 * Ported agent brains from NousResearch/hermes-agent and
 * moltis-org/moltis. Enable one, both, or neither; the engine
 * layers the brain prompt onto every system prompt (web console
 * + Telegram gateway) and arms the brain's tool dialect.
 * ============================================================ */

export function CognitionPanel() {
  const t = useT();
  const brains = useDeepInit((s) => s.brains);
  const setBrain = useDeepInit((s) => s.setBrain);
  const channels = useDeepInit((s) => s.channels);
  const { toast } = useToast();
  const [busy, setBusy] = useState<BrainId | null>(null);

  const paired = channels.some((c) => c.status === "connected");
  const sig = brainSignature(brains);

  const flip = async (id: BrainId, on: boolean) => {
    if (busy) return;
    setBusy(id);
    const res = await setBrain(id, on);
    setBusy(null);
    if (paired && !res.ok) {
      toast({
        title: t("brains.syncFail", { error: res.error || "unknown" }),
        variant: "destructive",
      });
    } else {
      toast({ title: t(on ? "brains.enabled" : "brains.disabled", { name: t(`brain.${id}.name`) }) });
    }
  };

  return (
    <div className="di-fade-up space-y-6">
      <Panel className="p-5">
        <MonoLabel>{t("brains.kicker")}</MonoLabel>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">{t("brains.title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("brains.sub")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs ${
              sig
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${sig ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`} />
            {sig ? t("brains.activeSig", { sig }) : t("brains.noneActive")}
          </span>
          {!paired && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
              {t("brains.needPair")}
            </span>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {BRAINS.map((b) => {
          const on = brains[b.id] === true;
          const isBusy = busy === b.id;
          return (
            <div
              key={b.id}
              className={`relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md ${
                on ? "border-primary ring-2 ring-primary/30" : "border-border/70"
              }`}
            >
              <div className="flex items-start justify-between gap-3 p-5 pb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl leading-none">{b.emoji}</span>
                  <div>
                    <h3 className="font-display text-lg font-semibold tracking-tight">
                      {t(`brain.${b.id}.name`)}
                    </h3>
                    <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                      {b.vendor}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <Switch
                    checked={on}
                    disabled={isBusy}
                    onCheckedChange={(v) => void flip(b.id, v)}
                    aria-label={t(`brain.${b.id}.name`)}
                  />
                </div>
              </div>
              <div className="px-5">
                <p className="text-sm text-muted-foreground">{t(`brain.${b.id}.tag`)}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 px-5">
                {b.caps.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <div className="mt-3 px-5">
                <p className="font-mono text-[11px] text-muted-foreground">
                  {t("brains.toolsAdvertised")}: {b.tools.join(" · ")}
                </p>
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 p-5 pt-4">
                <a
                  href={b.source}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> {b.source.replace("https://github.com/", "")}
                </a>
                <Button
                  size="sm"
                  variant={on ? "outline" : "default"}
                  disabled={isBusy}
                  onClick={() => void flip(b.id, !on)}
                  className="gap-2 font-mono text-xs"
                >
                  {on ? t("brains.turnOff") : t("brains.turnOn")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Panel className="p-5">
        <h3 className="font-display text-sm font-semibold tracking-tight">{t("brains.howTitle")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("brains.howBody")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("brains.howBoth")}</p>
      </Panel>
    </div>
  );
}
