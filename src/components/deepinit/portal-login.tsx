"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDeepInit } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { KeyRound, Loader2, ShieldCheck, Sparkles, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { CopyField, Logo, MonoLabel, Panel } from "./ui-bits";
import { LangSwitch } from "./lang-switch";

export const AUTH_SESSION_KEY = "di-portal-auth";

export function PortalLogin({ onSuccess }: { onSuccess: () => void }) {
  const profile = useDeepInit((s) => s.profile);
  const resetAll = useDeepInit((s) => s.resetAll);
  const t = useT();
  const { toast } = useToast();

  const [user, setUser] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  /* Escape hatch: if this browser holds an agent created before portal
     credentials existed (or they were wiped), mint a fresh set on entry so
     the operator is never permanently locked out. Runs exactly once at
     mount via the lazy initializer (store updates are idempotent). */
  const [minted] = useState(() => {
    const { profile: p, ensureCredentials: ensure } = useDeepInit.getState();
    if (!p.portalUser || !p.portalToken) {
      ensure();
      return true;
    }
    return false;
  });

  const attempt = (e?: React.FormEvent) => {
    e?.preventDefault();
    setChecking(true);
    setError(null);
    // brief beat so the terminal feel lands
    setTimeout(() => {
      const u = user.trim().toLowerCase();
      const tok = token.trim().toLowerCase();
      const userOk =
        u === (profile.portalUser || "").toLowerCase() ||
        u === (profile.displayName || "").toLowerCase();
      const tokenOk = Boolean(profile.portalToken) && tok === profile.portalToken!.toLowerCase();
      if (userOk && tokenOk) {
        try {
          sessionStorage.setItem(AUTH_SESSION_KEY, "1");
        } catch {
          /* private mode */
        }
        toast({ title: t("pl.toastTitle"), description: t("pl.toastBody", { name: profile.displayName }) });
        onSuccess();
      } else {
        setError(
          userOk || tokenOk
            ? t("pl.errorBoth")
            : t("pl.errorNo")
        );
      }
      setChecking(false);
    }, 450);
  };

  return (
    <div className="di-grid-bg flex min-h-screen items-center justify-center px-4">
      <div className="di-fade-up w-full max-w-md space-y-5">
        <div className="flex items-center justify-between">
          <Logo className="text-lg" />
          <div className="flex items-center gap-2">
            <LangSwitch />
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> {t("pl.kicker")}
            </span>
          </div>
        </div>

        <Panel className="p-6">
          <div className="border-b border-border/70 pb-4">
            <MonoLabel className="mb-1">{t("pl.locked", { agent: profile.agentName || "agent" })}</MonoLabel>
            <h1 className="text-xl font-bold tracking-tight">{t("pl.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("pl.sub")}</p>
          </div>

          <form className="mt-4 space-y-4" onSubmit={attempt}>
            <div className="space-y-2">
              <Label htmlFor="portal-user">{t("pl.user")}</Label>
              <Input
                id="portal-user"
                placeholder={profile.portalUser || "operator"}
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoFocus
                autoComplete="username"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-token">{t("pl.token")}</Label>
              <Input
                id="portal-token"
                placeholder="di_..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                autoComplete="current-password"
                className="font-mono"
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <Button type="submit" disabled={checking || !user.trim() || !token.trim()} className="w-full font-mono">
              {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              {checking ? t("pl.checking") : t("pl.submit")}
            </Button>
          </form>

          {minted && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-secondary/50 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <MonoLabel>{t("pl.mintTitle")}</MonoLabel>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t("pl.mintBody")}</p>
              <div className="mt-3 grid gap-2">
                <CopyField label={t("pl.fUser")} value={profile.portalUser || "—"} />
                <CopyField label={t("pl.fToken")} value={profile.portalToken || "—"} />
              </div>
            </div>
          )}

          <p className="mt-4 flex items-start gap-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            {t("pl.hint")}
          </p>
        </Panel>

        <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>{t("pl.lost")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 font-mono text-[11px] text-red-500 hover:text-red-400"
            onClick={() => {
              if (confirm(t("pl.resetConfirm"))) {
                try {
                  sessionStorage.removeItem(AUTH_SESSION_KEY);
                } catch {
                  /* ignore */
                }
                resetAll();
              }
            }}
          >
            {t("pl.reset")}
          </Button>
        </div>
      </div>
    </div>
  );
}
