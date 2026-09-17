import type { TunnelCommand } from "./types";

/**
 * In-memory relay store for the Deep-init pair tunnel.
 *
 * Machines running the pair-tunnel script check in here; the dashboard pushes
 * commands into their queue and the machine posts results back.
 *
 * NOTE: storage is per-server-instance memory (works in the sandbox and on
 * long-lived nodes; on serverless platforms entries live for the lambda's
 * warm lifetime). For a production multi-node deployment swap this module
 * for Redis/Postgres — the API surface stays identical.
 */

export interface RelayEntry {
  id: string;
  token: string;
  name: string;
  os: string;
  createdAt: string;
  lastSeen?: string;
  hostname?: string;
  uptime?: string;
  sysinfo?: string;
  commands: TunnelCommand[];
}

const g = globalThis as unknown as { __diRelay?: Map<string, RelayEntry> };
if (!g.__diRelay) g.__diRelay = new Map();

export const relay = {
  get: (id: string) => g.__diRelay!.get(id),
  set: (id: string, entry: RelayEntry) => g.__diRelay!.set(id, entry),
  delete: (id: string) => g.__diRelay!.delete(id),
  all: () => Array.from(g.__diRelay!.values()),

  verify: (id: string, token: string) => {
    const e = g.__diRelay!.get(id);
    return !!e && e.token === token;
  },

  enqueue: (id: string, command: string): TunnelCommand => {
    const e = g.__diRelay!.get(id);
    if (!e) throw new Error("unknown instance");
    const cmd: TunnelCommand = {
      id: `cmd_${Math.random().toString(36).slice(2, 10)}`,
      command,
      status: "queued",
      at: new Date().toISOString(),
    };
    e.commands.push(cmd);
    return cmd;
  },

  /** Pop queued commands for a machine (marks them in-flight → done when result arrives). */
  drain: (id: string): TunnelCommand[] => {
    const e = g.__diRelay!.get(id);
    if (!e) return [];
    const out = e.commands.filter((c) => c.status === "queued");
    return out;
  },

  complete: (id: string, commandId: string, result: string, isError = false) => {
    const e = g.__diRelay!.get(id);
    if (!e) return;
    const cmd = e.commands.find((c) => c.id === commandId);
    if (cmd) {
      cmd.status = isError ? "error" : "done";
      cmd.result = result;
    }
  },

  history: (id: string): TunnelCommand[] => {
    const e = g.__diRelay!.get(id);
    return e ? [...e.commands].reverse().slice(0, 50) : [];
  },
};

export function machineStatus(lastSeen?: string): "pending" | "online" | "stale" {
  if (!lastSeen) return "pending";
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age < 30_000) return "online";
  if (age < 150_000) return "stale";
  return "stale";
}
