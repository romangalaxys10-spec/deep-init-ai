"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PRESETS } from "@/lib/presets";
import { useDeepInit } from "@/lib/store";
import { Check, Loader2, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { MonoLabel, Panel } from "./ui-bits";

/* ============================================================
 * PresetsPanel — one-click specialist modes (Agentica-inspired).
 * Activating a preset re-writes the agent's system prompt on the
 * gateway (/api/agent/config) and swaps the console starters.
 * ============================================================ */

export function PresetsPanel() {
  const t = useT();
  const activePreset = useDeepInit((s) => s.activePreset);
  const activatePreset = useDeepInit((s) => s.activatePreset);
  const channels = useDeepInit((s) => s.channels);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const paired = channels.some((c) => c.status === "connected");

  const toggle = async (id: string) => {
    if (busy) return;
    const turningOff = activePreset === id;
    setBusy(id);
    const res = await activatePreset(turningOff ? null : id);
    setBusy(null);
    if (paired && !res.ok) {
      toast({
        title: t("presets.syncFail", { error: res.error || "unknown" }),
        variant: "destructive",
      });
    } else {
      toast({ title: turningOff ? t("tab.presets") : t("presets.synced") });
    }
  };

  return (
    <div className="di-fade-up space-y-6">
      <Panel className="p-5">
        <MonoLabel>{t("presets.kicker")}</MonoLabel>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
          {t("presets.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("presets.sub")}</p>
        {!paired && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
            <Sparkles className="h-3 w-3" /> {t("presets.needPair")}
          </p>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PRESETS.map((p) => {
          const isActive = activePreset === p.id;
          const isBusy = busy === p.id;
          return (
            <div
              key={p.id}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md ${
                isActive ? "border-primary ring-2 ring-primary/30" : "border-border/70"
              }`}
            >
              <div className="flex items-start justify-between gap-3 p-5 pb-3">
                <span className="text-3xl leading-none">{p.emoji}</span>
                <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {p.category}
                </span>
              </div>
              <div className="px-5">
                <h3 className="font-display text-lg font-semibold tracking-tight">
                  {t(`preset.${p.id}.name`)}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(`preset.${p.id}.tag`)}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 px-5">
                {p.caps.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-1 px-5">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Zap className="h-3 w-3" /> {t("presets.starters")}
                </span>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {p.starters.slice(0, 2).map((s) => (
                    <li key={s} className="truncate">
                      · {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-auto p-5 pt-4">
                <Button
                  onClick={() => toggle(p.id)}
                  disabled={busy !== null}
                  size="sm"
                  variant={isActive ? "outline" : "default"}
                  className={`w-full gap-2 font-mono text-xs ${isActive ? "border-primary/50 text-primary" : ""}`}
                >
                  {isBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isActive ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                  {isActive ? t("presets.active") : t("presets.activate")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
