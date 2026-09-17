"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDeepInit, slugifyUser } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { KeyRound, Loader2, ShieldCheck, Sparkles, TerminalSquare, UserRound } from "lucide-react";
import { useState } from "react";
import { CopyField, Logo, MonoLabel, Panel } from "./ui-bits";
import { LangSwitch } from "./lang-switch";

export const AUTH_SESSION_KEY = "di-portal-auth";

type LoginMode = "returning" | "new";

export function PortalLogin({ onSuccess }: { onSuccess: () => void }) {
  const profile = useDeepInit((s) => s.profile);
  const resetAll = useDeepInit((s) => s.resetAll);
  const regenerate = useDeepInit((s) => s.regeneratePortalCredentials);
  const t = useT();
  const { toast } = useToast();

  const [mode, setMode] = useState<LoginMode>("returning");
  const [user, setUser] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  /* new-user flow: pick a username → mint credentials → enter */
  const [newUser, setNewUser] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [generated, setGenerated] = useState(false);

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

  /* suggest the current/slugged username for the "new user" form — runs
     after the minted initializer above, so freshly-minted creds show up */
  const [suggestedUser] = useState(() => {
    const p = useDeepInit.getState().profile;
    return p.portalUser || slugifyUser(p.displayName || "") || "operator";
  });

  const grantAccess = (name: string) => {
    try {
      sessionStorage.setItem(AUTH_SESSION_KEY, "1");
    } catch {
      /* private mode */
    }
    toast({ title: t("pl.toastTitle"), description: t("pl.toastBody", { name }) });
    onSuccess();
  };

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
        grantAccess(profile.displayName || profile.portalUser || u);
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

  const generate = (e?: React.FormEvent) => {
    e?.preventDefault();
    const slug = slugifyUser(newUser.trim() || suggestedUser);
    if (slug.length < 3 || slug.length > 24) {
      setNewError(t("pl.newUserInvalid"));
      return;
    }
    setNewError(null);
    setMinting(true);
    // brief beat so the terminal feel lands
    setTimeout(() => {
      regenerate(slug);
      setGenerated(true);
      setMinting(false);
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
            <h1 className="text-xl font-bold tracking-tight">
              {mode === "returning" ? t("pl.title") : t("pl.newTitle")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "returning" ? t("pl.sub") : t("pl.newSub")}
            </p>
          </div>

          {/* mode selector: returning user vs generate new user / token */}
          <div
            role="tablist"
            aria-label={t("pl.kicker")}
            className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-secondary/40 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "returning"}
              onClick={() => setMode("returning")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs transition-colors",
                mode === "returning"
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("pl.tabReturn")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "new"}
              onClick={() => {
                setMode("new");
                if (!newUser) setNewUser(suggestedUser);
              }}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs transition-colors",
                mode === "new"
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("pl.tabNew")}</span>
            </button>
          </div>

          {mode === "returning" ? (
            <>
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
            </>
          ) : (
            <>
              <form className="mt-4 space-y-4" onSubmit={generate}>
                <div className="space-y-2">
                  <Label htmlFor="new-portal-user">{t("pl.user")}</Label>
                  <Input
                    id="new-portal-user"
                    placeholder={suggestedUser}
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                    autoFocus
                    autoComplete="off"
                    className="font-mono"
                  />
                  <p className="font-mono text-[10px] text-muted-foreground">{t("pl.newUserHint")}</p>
                </div>
                {newError && <p className="text-xs text-red-500">{newError}</p>}
                <Button type="submit" disabled={minting} className="w-full font-mono">
                  {minting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {minting ? t("pl.generating") : t("pl.generate")}
                </Button>
              </form>

              {generated && (
                <div className="mt-4 rounded-xl border border-primary/30 bg-secondary/50 p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <MonoLabel>{t("pl.newReady")}</MonoLabel>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t("pl.newReadyBody")}</p>
                  <div className="mt-3 grid gap-2">
                    <CopyField label={t("pl.fUser")} value={profile.portalUser || "—"} />
                    <CopyField label={t("pl.fToken")} value={profile.portalToken || "—"} />
                  </div>
                  <Button className="mt-3 w-full font-mono" onClick={() => grantAccess(profile.displayName || profile.portalUser || "")}>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {t("pl.enter")}
                  </Button>
                </div>
              )}

              <p className="mt-4 flex items-start gap-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                {t("pl.newNote")}
              </p>
            </>
          )}
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
