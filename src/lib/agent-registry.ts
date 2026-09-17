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
 * Storage strategy (serverless-friendly):
 * - production: Vercel Blob (`gateway/registry.json`) — shared across
 *   lambda instances, so webhooks always find the agent config.
 *   Handlers call refreshRegistry() on entry and persistRegistry()
 *   after mutating (last-write-wins at this scale).
 * - dev: JSON file under <cwd>/.gateway → shared across Next.js dev
 *   worker processes (a pure globalThis map gets split across workers).
 * - fallback: in-memory.
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
  /** durable long-term memory facts (remember/recall tools) */
  memory?: { at: number; text: string }[];
  /** scheduled proactive messages (remind tool) */
  reminders?: Reminder[];
  /** activated agent preset id (presets library) */
  presetId?: string;
}

export interface Reminder {
  id: string;
  chatId: number;
  text: string;
  dueAt: number;
  done: boolean;
  createdAt: number;
}

const MAX_THREAD = 24;
const AGENT_TTL_MS = 24 * 60 * 60 * 1000;

/* ---------------- in-process memory layer ---------------- */

const g = globalThis as unknown as {
  __diAgents?: Map<string, RegisteredAgent>;
  __diBlobFetchedAt?: number;
};
const mem: Map<string, RegisteredAgent> = (g.__diAgents ??= new Map());

/* ---------------- file store (dev) ---------------- */

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

/* ---------------- blob store (production) ---------------- */

const BLOB_PATH = "gateway/registry.json";

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN) && process.env.NODE_ENV === "production";
}

async function blobReadRaw(): Promise<{ raw: string | null; etag: string | null }> {
  try {
    const { get } = await import("@vercel/blob");
    // useCache:false is CRITICAL — private blob reads are cached per edge by
    // default, which serves stale registry state to other lambda instances
    const res = await get(BLOB_PATH, { access: "private", useCache: false });
    if (!res?.stream) return { raw: null, etag: null };
    const etag = res.headers?.get("etag") ?? null;
    const reader = res.stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const bytes = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    return { raw: new TextDecoder().decode(bytes), etag };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "BlobNotFoundError") return { raw: null, etag: null };
    console.error("[registry:blob-read]", name || e);
    return { raw: null, etag: null };
  }
}

/* ---------------- serialization ---------------- */

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
    map.set(k, {
      ...rest,
      memory: Array.isArray(rest.memory) ? rest.memory : [],
      reminders: Array.isArray(rest.reminders) ? rest.reminders : [],
      chats: new Map(chats.map((c) => [c.chatId, c])),
    });
  }
  return map;
}

/** Test hook: current in-memory state as JSON (scripts only). */
export function serializeForTest(): Record<string, unknown> {
  return JSON.parse(serialize(mem));
}

/* ---------------- refresh / persist ---------------- */

function mergeIntoMem(fromDisk: Map<string, RegisteredAgent>) {
  for (const [k, a] of fromDisk) {
    const m = mem.get(k);
    if (!m || m.lastSeen < a.lastSeen) mem.set(k, a);
  }
}

const REFRESH_DEDUPE_MS = 1_200;

/**
 * Pull the latest state into the in-process memory map.
 * Call at the start of every gateway request.
 * `force` bypasses the per-instance dedupe cache — used to heal
 * cross-instance eventual-consistency windows after a miss.
 */
export async function refreshRegistry(opts?: { force?: boolean }): Promise<void> {
  const now = Date.now();
  if (blobEnabled()) {
    if (!opts?.force && g.__diBlobFetchedAt && now - g.__diBlobFetchedAt < REFRESH_DEDUPE_MS) return;
    g.__diBlobFetchedAt = now;
    const { raw } = await blobReadRaw();
    if (raw) {
      try {
        mergeIntoMem(hydrate(JSON.parse(raw) as Record<string, SerializedAgent>));
      } catch {
        /* corrupt blob — start fresh from mem */
      }
    }
    return;
  }
  if (fsWorks()) {
    try {
      const file = storeFile();
      if (!existsSync(file)) return;
      mergeIntoMem(hydrate(JSON.parse(readFileSync(file, "utf8")) as Record<string, SerializedAgent>));
    } catch {
      /* unreadable file — keep mem */
    }
  }
}

/**
 * Push the in-memory state to the shared store.
 *
 * Blob mode re-reads the latest state and merges it into memory before
 * writing (last-write-wins with a merge window of one round-trip). This
 * keeps concurrent lambda instances converging instead of clobbering
 * each other's registrations and chat bindings.
 */
export async function persistRegistry(): Promise<void> {
  if (blobEnabled()) {
    try {
      const { raw } = await blobReadRaw(); // fresh read for the merge
      if (raw) {
        try {
          mergeIntoMem(hydrate(JSON.parse(raw) as Record<string, SerializedAgent>));
        } catch {
          /* corrupt blob — overwrite with mem */
        }
      }
      const { put } = await import("@vercel/blob");
      await put(BLOB_PATH, serialize(mem), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      g.__diBlobFetchedAt = Date.now();
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[registry:blob-write]", name, msg.slice(0, 200));
    }
    return;
  }
  if (fsWorks()) {
    try {
      mkdirSync(path.join(process.cwd(), ".gateway"), { recursive: true });
      writeFileSync(storeFile(), serialize(mem));
    } catch {
      /* read-only fs — memory is the fallback */
    }
  }
}

/* ---------------- agent operations (in-memory, sync) ---------------- */

function sweep() {
  const now = Date.now();
  for (const [key, a] of mem) {
    if (now - a.lastSeen > AGENT_TTL_MS) mem.delete(key);
  }
}

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
  sweep();
  const prev = mem.get(input.key);
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
    memory: prev?.memory ?? [],
    reminders: prev?.reminders ?? [],
    presetId: prev?.presetId,
  };
  mem.set(input.key, agent);
  return agent;
}

export function getAgent(key: string | null | undefined): RegisteredAgent | undefined {
  if (!key) return undefined;
  return mem.get(key);
}

/** All agents wired to a given bot token (the built-in bot hosts many users). */
export function agentsForBot(botToken: string): RegisteredAgent[] {
  sweep();
  return [...mem.values()].filter((a) => a.botToken === botToken);
}

/** Snapshot of every registered agent (cron flusher, diagnostics). */
export function allAgents(): RegisteredAgent[] {
  return [...mem.values()];
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
    if (a.ownerToken && a.ownerToken.toUpperCase() === t) {
      return { agent: a, mode: "owner", userName: a.ownerName };
    }
    const wl = a.whitelist.find((w) => w.token && w.token.toUpperCase() === t);
    if (wl) {
      return { agent: a, mode: wl.mode, userName: wl.name };
    }
  }
  return undefined;
}

/** Finds any agent owned by the given pairing/owner token (config updates from the portal). */
export function findAgentByOwner(ownerToken: string): RegisteredAgent | undefined {
  const t = ownerToken.toUpperCase();
  for (const a of mem.values()) {
    if (a.ownerToken?.toUpperCase() === t) return a;
  }
  return undefined;
}

/* ---------------- long-term memory (remember/recall tools) ---------------- */

const MAX_MEMORY = 100;

export function rememberFact(agent: RegisteredAgent, text: string): void {
  if (!agent.memory) agent.memory = [];
  agent.memory.push({ at: Date.now(), text: text.slice(0, 400) });
  if (agent.memory.length > MAX_MEMORY) agent.memory.splice(0, agent.memory.length - MAX_MEMORY);
  agent.lastSeen = Date.now();
}

export function searchMemory(agent: RegisteredAgent, query?: string): { at: number; text: string }[] {
  const mems = agent.memory ?? [];
  if (!query?.trim()) return mems.slice(-8).reverse();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return mems
    .filter((m) => tokens.some((tk) => m.text.toLowerCase().includes(tk)))
    .slice(-8)
    .reverse();
}

/* ---------------- reminders (remind tool + cron flush) ---------------- */

const MAX_REMINDERS = 50;

export function addReminder(
  agent: RegisteredAgent,
  r: { chatId: number; text: string; dueAt: number }
): Reminder {
  if (!agent.reminders) agent.reminders = [];
  const reminder: Reminder = {
    id: `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    chatId: r.chatId,
    text: r.text.slice(0, 400),
    dueAt: r.dueAt,
    done: false,
    createdAt: Date.now(),
  };
  agent.reminders.push(reminder);
  if (agent.reminders.length > MAX_REMINDERS) {
    agent.reminders = agent.reminders.filter((x) => !x.done).slice(-MAX_REMINDERS);
  }
  agent.lastSeen = Date.now();
  return reminder;
}

/** Due, not-yet-delivered reminders (dueAt <= now). */
export function dueReminders(agent: RegisteredAgent, now = Date.now()): Reminder[] {
  return (agent.reminders ?? []).filter((r) => !r.done && r.dueAt <= now);
}

export function markRemindersDone(agent: RegisteredAgent, ids: string[]): void {
  if (!agent.reminders) return;
  for (const r of agent.reminders) {
    if (ids.includes(r.id)) r.done = true;
  }
  agent.lastSeen = Date.now();
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
  return state;
}

/** Marks the agent as touched; call persistRegistry() in the handler afterwards. */
export function touchAgent(agent: RegisteredAgent) {
  agent.lastSeen = Date.now();
}

export function pushThread(thread: ChatMsg[], msg: ChatMsg) {
  thread.push(msg);
  while (thread.length > MAX_THREAD) thread.shift();
}

export function recordReply(agent: RegisteredAgent, chatId: number, reply: string) {
  agent.recentReplies.unshift({ at: Date.now(), chatId, preview: reply.slice(0, 120) });
  if (agent.recentReplies.length > 20) agent.recentReplies.pop();
}
