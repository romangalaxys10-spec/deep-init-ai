"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDeepInit } from "@/lib/store";
import { KeyRound, Loader2, ShieldCheck, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { Logo, MonoLabel, Panel } from "./ui-bits";

export const AUTH_SESSION_KEY = "di-portal-auth";

export function PortalLogin({ onSuccess }: { onSuccess: () => void }) {
  const profile = useDeepInit((s) => s.profile);
  const resetAll = useDeepInit((s) => s.resetAll);
  const { toast } = useToast();

  const [user, setUser] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const attempt = (e?: React.FormEvent) => {
    e?.preventDefault();
    setChecking(true);
    setError(null);
    // brief beat so the terminal feel lands
    setTimeout(() => {
      const userOk =
        user.trim().toLowerCase() === (profile.portalUser || "").toLowerCase() ||
        user.trim().toLowerCase() === (profile.displayName || "").toLowerCase();
      const tokenOk = token.trim() === (profile.portalToken || "");
      if (userOk && tokenOk) {
        try {
          sessionStorage.setItem(AUTH_SESSION_KEY, "1");
        } catch {
          /* private mode */
        }
        toast({ title: "Access granted", description: `Welcome back, ${profile.displayName}.` });
        onSuccess();
      } else {
        setError(
          userOk || tokenOk
            ? "Both the username and the token are required and must match."
            : "No match. Credentials were generated during the wizard and live in this browser."
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
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> portal access
          </span>
        </div>

        <Panel className="p-6">
          <div className="border-b border-border/70 pb-4">
            <MonoLabel className="mb-1">{`${profile.agentName || "agent"} · locked`}</MonoLabel>
            <h1 className="text-xl font-bold tracking-tight">Authenticate to open the console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Log in with the username + access token generated during the initial wizard.
            </p>
          </div>

          <form className="mt-4 space-y-4" onSubmit={attempt}>
            <div className="space-y-2">
              <Label htmlFor="portal-user">Username</Label>
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
              <Label htmlFor="portal-token">Access token</Label>
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
            {error && <p className="text-xs text-red-400">{error}</p>}
            <Button type="submit" disabled={checking || !user.trim() || !token.trim()} className="w-full font-mono">
              {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              {checking ? "checking..." : "Unlock console"}
            </Button>
          </form>

          <p className="mt-4 flex items-start gap-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            credentials live in this browser&apos;s local storage — check the wizard&apos;s final &ldquo;access
            credentials&rdquo; screen if you saved them elsewhere.
          </p>
        </Panel>

        <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>lost access on this device?</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 font-mono text-[11px] text-red-400 hover:text-red-300"
            onClick={() => {
              if (confirm("Factory reset this browser's agent data and start a fresh wizard?")) {
                try {
                  sessionStorage.removeItem(AUTH_SESSION_KEY);
                } catch {
                  /* ignore */
                }
                resetAll();
              }
            }}
          >
            factory reset
          </Button>
        </div>
      </div>
    </div>
  );
}
