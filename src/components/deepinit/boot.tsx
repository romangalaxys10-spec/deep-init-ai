"use client";

import { Button } from "@/components/ui/button";
import { useDeepInit } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Logo, MonoLabel, Panel } from "./ui-bits";

export function BootSequence({ onDone }: { onDone: () => void }) {
  const profile = useDeepInit((s) => s.profile);
  const channels = useDeepInit((s) => s.channels);
  const providers = useDeepInit((s) => s.providers);
  const questionnaire = useDeepInit((s) => s.questionnaire);
  const tools = useDeepInit((s) => s.tools);
  const activate = useDeepInit((s) => s.activate);
  const logActivity = useDeepInit((s) => s.logActivity);
  const t = useT();

  const [lineCount, setLineCount] = useState(0);
  const firedRef = useRef(false);

  const sorted = [...providers].filter((p) => p.enabled).sort((a, b) => a.priority - b.priority);
  const chainLabel = sorted.length
    ? sorted.map((p, i) => `#${i + 1} ${p.label}`).join(" → ") + " → demo brain"
    : "demo brain";
  const connected = channels.filter((c) => c.status === "connected");

  const lines = [
    "deep-init v1.0.0 — booting agent kernel",
    `loading operator profile .......... ${profile.displayName}`,
    `agent callsign .................... ${profile.agentName}`,
    `timezone .......................... ${profile.timezone}`,
    `mounting channels ................. ${connected.length ? connected.map((c) => c.type).join(" ✔ ") + " ✔" : "none yet — pair later"}`,
    `arming fallback chain ............. ${chainLabel}`,
    `loading directives ................ ${questionnaire.goals.length} focus areas · ${questionnaire.autonomy} autonomy`,
    `enabling capability modules ....... ${tools.filter((t) => t.enabled).length}/${tools.length}`,
    "self-learning loop ................ ON",
    "heartbeat scheduler ............... armed (60s)",
    `★ agent ONLINE — ${profile.agentName} is now working for ${profile.displayName}`,
  ];

  useEffect(() => {
    const iv = setInterval(() => {
      setLineCount((c) => {
        if (c >= lines.length) {
          clearInterval(iv);
          return c;
        }
        return c + 1;
      });
    }, 380);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (lineCount >= lines.length && !firedRef.current) {
      firedRef.current = true;
      const t = setTimeout(() => {
        if (!firedRef.current) return;
        activate();
        logActivity({
          kind: "system",
          title: `${profile.agentName} initialized`,
          detail: `Operator: ${profile.displayName} · chain: ${sorted.length || 0} provider(s) · channels: ${connected.length}`,
        });
        onDone();
      }, 900);
      return () => clearTimeout(t);
    }
  }, [lineCount, lines.length, activate, logActivity, onDone, profile.agentName, profile.displayName, sorted.length, connected.length]);

  const done = lineCount >= lines.length;

  return (
    <div className="di-grid-bg flex min-h-screen items-center justify-center px-4">
      <Panel glow className="di-scanline w-full max-w-2xl p-6 sm:p-8">
        <div className="mb-5 flex items-center justify-between border-b border-border/70 pb-4">
          <div className="flex items-center gap-3">
            <Logo className="text-lg" />
            <MonoLabel>{t("boot.label")}</MonoLabel>
          </div>
          <div className="flex gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${done ? "bg-primary" : "bg-amber-400"}`} />
            <span className={`h-2.5 w-2.5 rounded-full ${done ? "bg-primary" : "bg-muted"}`} />
          </div>
        </div>

        <div className="min-h-[300px] font-mono text-[13px] leading-loose">
          {lines.slice(0, lineCount).map((l, i) => (
            <div key={i} className="di-fade-up">
              <span className="text-primary">❯</span>{" "}
              <span className={l.startsWith("★") ? "text-primary" : "text-foreground/85"}>{l}</span>
            </div>
          ))}
          {!done && <span className="text-primary di-cursor">▊</span>}
          {done && (
            <div className="di-fade-up mt-6">
              <Button onClick={onDone} size="lg" className="di-glow w-full font-mono">
                {t("boot.enter")}
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
