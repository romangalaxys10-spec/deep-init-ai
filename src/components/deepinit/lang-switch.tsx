"use client";

import { LANGS } from "@/lib/i18n";
import { useDeepInit } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Languages } from "lucide-react";

/** EN / RU / עברית pill switch — shared by landing, portal login and dashboard. */
export function LangSwitch({ className }: { className?: string }) {
  const lang = useDeepInit((s) => s.uiLang);
  const setUiLang = useDeepInit((s) => s.setUiLang);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-background/60 p-1",
        className
      )}
      role="group"
      aria-label="Language / Язык / שפה"
    >
      <Languages className="ms-1 h-3 w-3 text-muted-foreground" aria-hidden />
      {LANGS.map((it) => (
        <button
          key={it.id}
          onClick={() => setUiLang(it.id)}
          aria-pressed={lang === it.id}
          title={it.label}
          className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-4 transition-colors sm:px-2 ${
            lang === it.id
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {/* compact codes on phones — full names from sm up (keeps narrow headers overflow-free) */}
          <span className="sm:hidden">{it.short}</span>
          <span className="hidden sm:inline">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
