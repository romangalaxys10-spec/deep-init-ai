"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("font-mono font-bold tracking-tight select-none", className)}>
      <span className="text-primary">deep</span>
      <span className="text-muted-foreground">-</span>
      <span className="text-foreground">init</span>
      <span className="text-primary di-cursor">_</span>
    </span>
  );
}

export function MonoLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function StatusDot({ ok, className }: { ok: boolean | "warn"; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)}>
      {ok !== false && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full di-pulse-ring",
            ok === "warn" ? "bg-amber-400" : "bg-primary"
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          ok === true ? "bg-primary" : ok === "warn" ? "bg-amber-400" : "bg-red-500"
        )}
      />
    </span>
  );
}

/** Types out lines like a boot log. */
export function BootLog({
  lines,
  className,
  speed = 420,
  loop = false,
}: {
  lines: string[];
  className?: string;
  speed?: number;
  loop?: boolean;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const total = lines.length;
    const iv = setInterval(() => {
      setTick((t) => {
        if (!loop) return t >= total ? t : t + 1;
        // loop: hold full text briefly, then restart
        return t >= total + 6 ? 0 : t + 1;
      });
    }, speed);
    return () => clearInterval(iv);
  }, [speed, loop, lines.length]);

  const count = Math.min(tick, lines.length);
  const shown = lines.slice(0, count);

  return (
    <div className={cn("font-mono text-xs leading-relaxed", className)}>
      {shown.map((l, i) => (
        <div key={i} className="di-fade-up">
          <span className="text-primary">❯</span>{" "}
          <span className="text-foreground/85">{l}</span>
        </div>
      ))}
      <span className="text-primary di-cursor">▊</span>
    </div>
  );
}

export function Panel({
  children,
  className,
  glow,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur",
        glow && "di-glow",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Labeled mono value with a copy-to-clipboard button. */
export function CopyField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2",
        className
      )}
    >
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-sm text-foreground" title={value}>
          {value}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            /* clipboard unavailable */
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
