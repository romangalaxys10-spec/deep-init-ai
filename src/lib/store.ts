"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActivityEvent,
  AgentTool,
  AIProvider,
  ChatMessage,
  MessagingChannel,
  Questionnaire,
  UserProfile,
  View,
} from "./types";

export const BUILTIN_TOOLS: AgentTool[] = [
  { id: "bi-web", kind: "builtin", name: "Web Search & Fetch", enabled: true, status: "ok", detail: "Search, open and extract any page" },
  { id: "bi-browser", kind: "builtin", name: "Browser Automation", enabled: true, status: "ok", detail: "Click, type, scroll — a full headless browser" },
  { id: "bi-fs", kind: "builtin", name: "File System", enabled: true, status: "ok", detail: "Read, write and organize files on the host" },
  { id: "bi-code", kind: "builtin", name: "Code Runner", enabled: true, status: "ok", detail: "Execute Python / Node / Shell in a sandbox" },
  { id: "bi-mail", kind: "builtin", name: "Email & Inbox", enabled: false, status: "untested", detail: "Read, draft and send email on your behalf" },
  { id: "bi-sched", kind: "builtin", name: "Scheduler & Cron", enabled: true, status: "ok", detail: "Wake itself up on a schedule, 24/7 loop" },
  { id: "bi-mem", kind: "builtin", name: "Long-term Memory", enabled: true, status: "ok", detail: "Remembers people, projects and preferences" },
  { id: "bi-vision", kind: "builtin", name: "Vision & Screenshots", enabled: false, status: "untested", detail: "Read screens, images and documents" },
];

interface DeepInitState {
  hydrated: boolean;
  view: View;
  wizardStep: number;
  profile: UserProfile;
  channels: MessagingChannel[];
  providers: AIProvider[];
  tools: AgentTool[];
  questionnaire: Questionnaire;
  agentActive: boolean;
  activatedAt?: string;
  messages: ChatMessage[];
  activity: ActivityEvent[];

  setView: (v: View) => void;
  setWizardStep: (s: number) => void;
  setProfile: (p: Partial<UserProfile>) => void;
  addChannel: (c: MessagingChannel) => void;
  updateChannel: (id: string, patch: Partial<MessagingChannel>) => void;
  removeChannel: (id: string) => void;
  addProvider: (p: AIProvider) => void;
  updateProvider: (id: string, patch: Partial<AIProvider>) => void;
  removeProvider: (id: string) => void;
  moveProvider: (id: string, dir: -1 | 1) => void;
  toggleTool: (id: string) => void;
  addTool: (t: AgentTool) => void;
  updateTool: (id: string, patch: Partial<AgentTool>) => void;
  removeTool: (id: string) => void;
  setQuestionnaire: (q: Partial<Questionnaire>) => void;
  activate: () => void;
  addMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  logActivity: (e: Omit<ActivityEvent, "id" | "at">) => void;
  resetAll: () => void;
  setHydrated: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const defaultQuestionnaire: Questionnaire = {
  goals: [],
  autonomy: "suggested",
  personality: "friendly",
  schedule: "247",
  customHours: "",
  language: "English",
  notes: "",
};

export const useDeepInit = create<DeepInitState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      view: "landing",
      wizardStep: 0,
      profile: { displayName: "", agentName: "Init", timezone: "UTC" },
      channels: [],
      providers: [],
      tools: BUILTIN_TOOLS,
      questionnaire: defaultQuestionnaire,
      agentActive: false,
      activatedAt: undefined,
      messages: [],
      activity: [],

      setHydrated: () => set({ hydrated: true }),
      setView: (view) => set({ view }),
      setWizardStep: (wizardStep) => set({ wizardStep }),
      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),

      addChannel: (c) => set((s) => ({ channels: [...s.channels.filter((x) => x.type !== c.type), c] })),
      updateChannel: (id, patch) =>
        set((s) => ({ channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeChannel: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),

      addProvider: (p) => set((s) => ({ providers: [...s.providers, p] })),
      updateProvider: (id, patch) =>
        set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeProvider: (id) => set((s) => ({ providers: s.providers.filter((p) => p.id !== id) })),
      moveProvider: (id, dir) =>
        set((s) => {
          const sorted = [...s.providers].sort((a, b) => a.priority - b.priority);
          const idx = sorted.findIndex((p) => p.id === id);
          const swapWith = idx + dir;
          if (idx < 0 || swapWith < 0 || swapWith >= sorted.length) return {};
          const a = sorted[idx];
          const b = sorted[swapWith];
          const swap = (p: AIProvider): AIProvider =>
            p.id === a.id ? { ...p, priority: b.priority } : p.id === b.id ? { ...p, priority: a.priority } : p;
          return { providers: s.providers.map(swap) };
        }),

      toggleTool: (id) =>
        set((s) => ({
          tools: s.tools.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
        })),
      addTool: (t) => set((s) => ({ tools: [...s.tools, t] })),
      updateTool: (id, patch) =>
        set((s) => ({ tools: s.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      removeTool: (id) => set((s) => ({ tools: s.tools.filter((t) => t.id !== id) })),

      setQuestionnaire: (q) => set((s) => ({ questionnaire: { ...s.questionnaire, ...q } })),

      activate: () =>
        set((s) => ({
          agentActive: true,
          activatedAt: new Date().toISOString(),
          view: "dashboard",
        })),

      addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      updateMessage: (id, patch) =>
        set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      clearMessages: () => set({ messages: [] }),

      logActivity: (e) =>
        set((s) => ({
          activity: [{ ...e, id: uid(), at: new Date().toISOString() }, ...s.activity].slice(0, 200),
        })),

      resetAll: () =>
        set({
          view: "landing",
          wizardStep: 0,
          profile: { displayName: "", agentName: "Init", timezone: "UTC" },
          channels: [],
          providers: [],
          tools: BUILTIN_TOOLS,
          questionnaire: defaultQuestionnaire,
          agentActive: false,
          activatedAt: undefined,
          messages: [],
          activity: [],
        }),
    }),
    {
      name: "deep-init-state-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        view: s.view,
        wizardStep: s.wizardStep,
        profile: s.profile,
        channels: s.channels,
        providers: s.providers,
        tools: s.tools,
        questionnaire: s.questionnaire,
        agentActive: s.agentActive,
        activatedAt: s.activatedAt,
        messages: s.messages,
        activity: s.activity,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);

export { uid };

/* ---------- Agent system prompt builder ---------- */

export function buildSystemPrompt(
  profile: UserProfile,
  q: Questionnaire,
  channels: MessagingChannel[],
  tools: AgentTool[]
): string {
  const persona: Record<Questionnaire["personality"], string> = {
    concise: "Be concise and professional. Lead with the answer, then minimal supporting detail.",
    friendly: "Be warm and friendly, like a capable personal chief-of-staff. Light humor is fine.",
    technical: "Be technical and precise. Include specifics, trade-offs and next steps.",
    playful: "Be playful and witty, but always deliver the result first.",
  };
  const autonomy: Record<Questionnaire["autonomy"], string> = {
    supervised: "Ask for confirmation before taking any real-world action.",
    suggested: "Propose what you will do, then act unless the user objects.",
    full: "Act autonomously without asking. Report what you did afterwards. This user wants full automation.",
  };
  const schedule =
    q.schedule === "247"
      ? "You run 24/7."
      : q.schedule === "workhours"
        ? `You are active during work hours${q.customHours ? ` (${q.customHours})` : ""}.`
        : `Your active hours: ${q.customHours || "custom"}.`;

  const goals = q.goals.length ? q.goals.join(", ") : "general assistance";
  const connected = channels.filter((c) => c.status === "connected").map((c) => c.type).join(", ");
  const enabledTools = tools.filter((t) => t.enabled).map((t) => t.name).join(", ");

  return [
    `You are ${profile.agentName}, the personal autonomous agent of ${profile.displayName || "your user"}, running inside Deep-init AI.`,
    `You operate 24/7 on the user's computer and can do anything a human can do on a computer: browse, search, read and write files, run code, call APIs, use MCP servers, and learn new skills.`,
    `Primary focus areas: ${goals}.`,
    persona[q.personality],
    autonomy[q.autonomy],
    schedule,
    `User timezone: ${profile.timezone}. Reply in ${q.language}.`,
    connected ? `Connected messengers: ${connected}.` : "",
    enabledTools ? `Enabled capability modules: ${enabledTools}.` : "",
    q.notes ? `Personal context from the user: ${q.notes}` : "",
    `You can self-create new skills and register new MCP endpoints / APIs / plugins when a task needs them.`,
  ]
    .filter(Boolean)
    .join("\n");
}
