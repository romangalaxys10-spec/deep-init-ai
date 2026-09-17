"use client";

import { useSyncExternalStore } from "react";
import { useDeepInit } from "@/lib/store";
import { Landing } from "@/components/deepinit/landing";
import { Wizard } from "@/components/deepinit/wizard";
import { BootSequence } from "@/components/deepinit/boot";
import { Dashboard } from "@/components/deepinit/dashboard";

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
    return <Wizard onInitialize={() => setView("booting")} />;
  }

  if (view === "booting") {
    return <BootSequence onDone={() => setView("dashboard")} />;
  }

  if (view === "dashboard" && agentActive) {
    return <Dashboard />;
  }

  return <Landing onInitialize={() => setView("wizard")} />;
}
