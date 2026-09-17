import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { ChatRequest } from "./types";

/* ============================================================
 * Server-side agent gateway registry
 *
 * Makes Telegram bots actually ANSWER: when an update arrives via
 * webhook (or the browser-driven poll bridge), we look up the agent
 * config bound to that bot/chat and run the provider fallback chain.
 *
 * Storage strategy:
 * - dev: JSON file under <cwd>/.gateway → shared across Next.js dev
 *   worker processes (a pure globalThis map gets split across workers)
 * - production (Vercel): read-only FS → in-memory per warm instance.
 *   The dashboard auto-resyncs its config, so cold instances heal as
 *   soon as the portal is opened.
 * ============================================================ */

export type ChatMode = "owner" | "shared" | "isolated";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ChatState {
  chatId: number;
  userName: string;
  mode: ChatMode;
  boundToken: string;
  boundAt: number;
  lastAt: number;
  /** private thread — used when mode === "isolated" */
  thread: ChatMsg[];
}

export interface RegisteredAgent {
  key: string; // "builtin:<ownerToken>" | "own:<botToken>"
  botToken: string;
  botUsername?: string;
  builtIn: boolean;
  agentName: string;
  ownerName: string;
  ownerToken: string;
  systemPrompt: string;
  providers: ChatRequest["providers"];
  allowDemoBrain: boolean;
  whitelist: { token: string; name: string; mode: "shared" | "isolated" }[];
  createdAt: number;
  lastSeen: number;
  /** telegram getUpdates offset (poll mode) */
  offset?: number;
  chats: Map<number, ChatState>;
  /** conversation history shared by the owner + "shared" whitelist users */
  sharedThread: ChatMsg[];
  recentReplies: { at: number; chatId: number; preview: string }[];
}

const MAX_THREAD = 24;
const AGENT_TTL_MS = 24 * 60 * 60 * 1000;

/* ---------------- file-backed store ---------------- */

const g = globalThis as unknown as { __diAgents?: Map<string, RegisteredAgent> };
const mem: Map<string, RegisteredAgent> = (g.__diAgents ??= new Map());

let fsEnabled: boolean | null = null;

function storeFile(): string {
  return path.join(process.cwd(), ".gateway", "registry.json");
}

function fsWorks(): boolean {
  if (fsEnabled !== null) return fsEnabled;
  if (process.env.NODE_ENV === "production") {
    fsEnabled = false;
    return fsEnabled;
  }
  try {
    const dir = path.join(process.cwd(), ".gateway");
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".probe");
    writeFileSync(probe, "1");
    fsEnabled = existsSync(probe);
    return fsEnabled;
  } catch {
    fsEnabled = false;
    return fsEnabled;
  }
}

interface SerializedAgent extends Omit<RegisteredAgent, "chats"> {
  chats: ChatState[];
}

function serialize(agents: Map<string, RegisteredAgent>): string {
  const out: Record<string, SerializedAgent> = {};
  for (const [k, a] of agents) {
    out[k] = { ...a, chats: [...a.chats.values()] };
  }
  return JSON.stringify(out);
}

function hydrate(raw: Record<string, SerializedAgent>): Map<string, RegisteredAgent> {
  const map = new Map<string, RegisteredAgent>();
  for (const [k, s] of Object.entries(raw)) {
    const { chats, ...rest } = s;
    map.set(k, { ...rest, chats: new Map(chats.map((c) => [c.chatId, c])) });
  }
  return map;
}

function loadAll(): Map<string, RegisteredAgent> {
  if (!fsWorks()) return mem;
  try {
    const file = storeFile();
    if (!existsSync(file)) return mem;
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, SerializedAgent>;
    const fromDisk = hydrate(raw);
    // merge disk over memory so any worker sees the latest state
    for (const [k, a] of fromDisk) {
      const m = mem.get(k);
      if (!m || m.lastSeen < a.lastSeen) mem.set(k, a);
    }
    return mem;
  } catch {
    return mem;
  }
}

function saveAll(agents: Map<string, RegisteredAgent>) {
  if (!fsWorks()) return;
  try {
    mkdirSync(path.join(process.cwd(), ".gateway"), { recursive: true });
    writeFileSync(storeFile(), serialize(agents));
  } catch {
    /* read-only fs (production) — memory is the fallback */
  }
}

function sweep(agents: Map<string, RegisteredAgent>) {
  const now = Date.now();
  let dirty = false;
  for (const [key, a] of agents) {
    if (now - a.lastSeen > AGENT_TTL_MS) {
      agents.delete(key);
      dirty = true;
    }
  }
  return dirty;
}

/* ---------------- public API ---------------- */

export interface RegisterInput {
  key: string;
  botToken: string;
  botUsername?: string;
  builtIn: boolean;
  agentName: string;
  ownerName: string;
  ownerToken: string;
  systemPrompt: string;
  providers: ChatRequest["providers"];
  allowDemoBrain: boolean;
  whitelist: { token: string; name: string; mode: "shared" | "isolated" }[];
}

export function registerAgent(input: RegisterInput): RegisteredAgent {
  const agents = loadAll();
  sweep(agents);
  const prev = agents.get(input.key);
  const agent: RegisteredAgent = {
    ...input,
    providers: (input.providers || []).filter((p) => p && p.baseUrl && p.model).slice(0, 10),
    whitelist: (input.whitelist || []).slice(0, 50),
    createdAt: prev?.createdAt ?? Date.now(),
    lastSeen: Date.now(),
    offset: prev?.offset,
    chats: prev?.chats ?? new Map(),
    sharedThread: prev?.sharedThread ?? [],
    recentReplies: prev?.recentReplies ?? [],
  };
  agents.set(input.key, agent);
  saveAll(agents);
  return agent;
}

export function getAgent(key: string | null | undefined): RegisteredAgent | undefined {
  if (!key) return undefined;
  // read-only: never mutate here, otherwise the in-memory copy's lastSeen
  // inflates above the disk copy and stale state wins the merge
  return loadAll().get(key);
}

/** All agents wired to a given bot token (the built-in bot hosts many users). */
export function agentsForBot(botToken: string): RegisteredAgent[] {
  const agents = loadAll();
  if (sweep(agents)) saveAll(agents);
  return [...agents.values()].filter((a) => a.botToken === botToken);
}

/** The agent whose chat map already contains this chat (i.e. it was paired). */
export function findBoundAgent(botToken: string, chatId: number): RegisteredAgent | undefined {
  return agentsForBot(botToken).find((a) => a.chats.has(chatId));
}

export interface TokenMatch {
  agent: RegisteredAgent;
  mode: ChatMode;
  userName: string;
}

/** Finds which agent (and access mode) a pairing token belongs to. */
export function findByPairingToken(botToken: string, token: string): TokenMatch | undefined {
  const t = token.toUpperCase();
  for (const a of agentsForBot(botToken)) {
    if (a.ownerToken.toUpperCase() === t) {
      return { agent: a, mode: "owner", userName: a.ownerName };
    }
    const wl = a.whitelist.find((w) => w.token.toUpperCase() === t);
    if (wl) {
      return { agent: a, mode: wl.mode, userName: wl.name };
    }
  }
  return undefined;
}

export function bindChat(
  agent: RegisteredAgent,
  chatId: number,
  opts: { mode: ChatMode; userName: string; token: string }
): ChatState {
  const existing = agent.chats.get(chatId);
  const state: ChatState = {
    chatId,
    userName: opts.userName,
    mode: opts.mode,
    boundToken: opts.token.toUpperCase(),
    boundAt: existing?.boundAt ?? Date.now(),
    lastAt: Date.now(),
    thread: existing?.thread ?? [],
  };
  agent.chats.set(chatId, state);
  agent.lastSeen = Date.now();
  touchAgent(agent);
  return state;
}

/** Call after mutating threads / replies / offsets on a live agent. */
export function touchAgent(agent: RegisteredAgent) {
  agent.lastSeen = Date.now();
  saveAll(loadAll());
}

export function pushThread(thread: ChatMsg[], msg: ChatMsg) {
  thread.push(msg);
  while (thread.length > MAX_THREAD) thread.shift();
}

export function recordReply(agent: RegisteredAgent, chatId: number, reply: string) {
  agent.recentReplies.unshift({ at: Date.now(), chatId, preview: reply.slice(0, 120) });
  if (agent.recentReplies.length > 20) agent.recentReplies.pop();
}
