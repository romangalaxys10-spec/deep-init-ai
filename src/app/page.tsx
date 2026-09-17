"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useDeepInit } from "@/lib/store";
import { dirOf } from "@/lib/i18n";
import { Landing } from "@/components/deepinit/landing";
import { Wizard } from "@/components/deepinit/wizard";
import { BootSequence } from "@/components/deepinit/boot";
import { Dashboard } from "@/components/deepinit/dashboard";
import { AUTH_SESSION_KEY, PortalLogin } from "@/components/deepinit/portal-login";

const emptySubscribe = () => () => {};

export default function Home() {
  const hydrated = useDeepInit((s) => s.hydrated);
  const view = useDeepInit((s) => s.view);
  const setView = useDeepInit((s) => s.setView);
  const agentActive = useDeepInit((s) => s.agentActive);

  // false during SSR / hydration paint, true on the client — no cascading setState
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // session-scoped portal authentication (set by the lock screen)
  const [authed, setAuthed] = useState(() =>
    typeof window === "undefined" ? false : sessionStorage.getItem(AUTH_SESSION_KEY) === "1"
  );

  // UI language → document direction (Hebrew = RTL) + lang attribute
  const uiLang = useDeepInit((s) => s.uiLang);
  useEffect(() => {
    document.documentElement.dir = dirOf(uiLang);
    document.documentElement.lang = uiLang;
  }, [uiLang]);

  // Prevent rendering persisted state before hydration to avoid mismatches.
  if (!mounted || !hydrated) {
    return (
      <div className="di-grid-bg flex min-h-screen items-center justify-center">
        <div className="font-mono text-sm text-muted-foreground">
          <span className="text-primary">deep-init</span> kernel loading
          <span className="di-cursor">▊</span>
        </div>
      </div>
    );
  }

  if (view === "wizard") {
    return (
      <Wizard
        onInitialize={() => {
          // completing the wizard on this device IS the first authentication —
          // the operator goes straight into the console after the boot log.
          try {
            sessionStorage.setItem(AUTH_SESSION_KEY, "1");
          } catch {
            /* private mode */
          }
          setAuthed(true);
          setView("booting");
        }}
      />
    );
  }

  if (view === "booting") {
    return <BootSequence onDone={() => setView("dashboard")} />;
  }

  if (view === "dashboard" && agentActive) {
    if (!authed) {
      return (
        <PortalLogin
          onSuccess={() => {
            setAuthed(true);
            setView("dashboard");
          }}
        />
      );
    }
    return (
      <Dashboard
        onLogout={() => {
          try {
            sessionStorage.removeItem(AUTH_SESSION_KEY);
          } catch {
            /* ignore */
          }
          setAuthed(false);
        }}
      />
    );
  }

  return <Landing onInitialize={() => setView("wizard")} />;
}
