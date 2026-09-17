/* ---------- Deep-init AI core types ---------- */

export type View = "landing" | "wizard" | "booting" | "dashboard";

export type ProviderCompat = "openai" | "anthropic";

export interface AIProvider {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  compat: ProviderCompat;
  enabled: boolean;
  /** lower number = tried first in the fallback chain */
  priority: number;
  lastStatus?: "ok" | "error" | "untested";
  lastLatencyMs?: number;
  lastError?: string;
  lastCheckedAt?: string;
}

export type ChannelType = "telegram";

export interface MessagingChannel {
  id: string;
  type: ChannelType;
  status: "pending" | "connected" | "error";
  label: string;
  /** telegram bot username, e.g. init_smart_bot */
  handle?: string;
  pairingCode?: string;
  connectedAt?: string;
  /** server-side gateway session key, e.g. "builtin:DIP-..." or "own:<token>" */
  sessionKey?: string;
  /** how updates reach the agent */
  gatewayMode?: "webhook" | "poll";
  /** true when paired against the built-in @init_smart_bot */
  builtIn?: boolean;
}

export type ToolKind = "mcp" | "api" | "plugin" | "builtin";

export interface AgentTool {
  id: string;
  kind: ToolKind;
  name: string;
  url?: string;
  authHeader?: string;
  enabled: boolean;
  status?: "ok" | "error" | "untested";
  lastLatencyMs?: number;
  detail?: string;
}

export interface Questionnaire {
  goals: string[];
  autonomy: "supervised" | "suggested" | "full";
  personality: "concise" | "friendly" | "technical" | "playful";
  schedule: "247" | "workhours" | "custom";
  customHours?: string;
  language: string;
  notes: string;
}

export interface UserProfile {
  displayName: string;
  agentName: string;
  timezone: string;
  /** web portal login — auto-generated in the wizard */
  portalUser?: string;
  portalToken?: string;
  /** the owner's Channel Pairing Token (sent to the bot to start chatting) */
  pairingToken?: string;
}

/* ---------- Channel access whitelist ---------- */

export interface WhitelistUser {
  id: string;
  name: string;
  /** shared = shares the agent's memory/context; isolated = private thread per user */
  mode: "shared" | "isolated";
  token: string;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  kind: "system" | "heartbeat" | "message" | "channel" | "provider" | "tool" | "task" | "error";
  title: string;
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  via?: string;
  latencyMs?: number;
  fallbackChain?: FallbackStep[];
}

/* ---------- Virtual instances ---------- */

export interface SSHInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: "password" | "key";
  password?: string;
  privateKey?: string;
  status: "untested" | "ok" | "error";
  lastError?: string;
  sysinfo?: { os?: string; whoami?: string; uptime?: string };
  lastCheckedAt?: string;
}

export interface TunnelMachine {
  id: string;
  token: string;
  name: string;
  os: string;
  status: "pending" | "online" | "stale";
  lastSeen?: string;
  hostname?: string;
  uptime?: string;
  sysinfo?: string;
}

export interface TunnelCommand {
  id: string;
  command: string;
  status: "queued" | "done" | "error";
  result?: string;
  at: string;
}

/* ---------- Voice ---------- */

export interface VoiceSettings {
  enabled: boolean;
  autoSpeak: boolean;
  voice: string;
  rate: number; // -50..50
  pitch: number; // -50..50
}

/* ---------- Skills ---------- */

export interface AgentSkill {
  id: string;
  name: string;
  source: "zcode" | "builtin" | "self";
  status: "armed" | "drafting";
  detail: string;
}

export interface FallbackStep {
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/* ---------- API payloads ---------- */

export interface GatewayChat {
  chatId: number;
  userName: string;
  mode: "owner" | "shared" | "isolated";
  boundAt: number;
  lastAt: number;
}

export interface GatewayStatus {
  registered: boolean;
  botUsername?: string;
  chats: GatewayChat[];
  recentReplies: { at: number; chatId: number; preview: string }[];
  boundTokens: string[];
}

export interface ChatRequest {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  providers: {
    id: string;
    label: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    compat: ProviderCompat;
  }[];
  allowDemoBrain?: boolean;
}

export interface ChatResponse {
  content: string;
  via: string;
  latencyMs: number;
  fallbackChain: FallbackStep[];
}
