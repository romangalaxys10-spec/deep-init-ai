"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActivityEvent,
  AgentSkill,
  AgentTool,
  AIProvider,
  ChatMessage,
  MessagingChannel,
  Questionnaire,
  SSHInstance,
  TunnelMachine,
  VoiceSettings,
  UserProfile,
  View,
  WhitelistUser,
} from "./types";
import type { Lang } from "./i18n";
import type { AgentPreset } from "./presets";
import { getPreset, presetPromptBlock } from "./presets";
import { DEFAULT_BRAIN_CONFIG, normalizeBrainConfig, type BrainConfig, type BrainId } from "./brains";
import { genPairingToken, genPortalToken, slugifyUser } from "./tokens";
import { VOICE_PERSONAS } from "./voice-personas";
import { providerKey } from "./active-provider";

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

export const BUILTIN_SKILLS: AgentSkill[] = [
  {
    id: "sk-smart",
    name: "zcode-smart-skill v2",
    source: "zcode",
    status: "armed",
    detail: "GVS5H ledger orchestration: plan → adversarial test-spec → work → verify-by-running, approach racing after 2 fails, done only with green verification. Applied to every hard build task.",
  },
  {
    id: "sk-pdf",
    name: "pdf-extract",
    source: "self",
    status: "armed",
    detail: "Self-created. Extracts tables and text from PDFs into clean markdown.",
  },
  {
    id: "sk-inbox",
    name: "inbox-triage",
    source: "self",
    status: "armed",
    detail: "Self-created. Clusters unread mail by urgency and drafts replies.",
  },
  {
    id: "sk-price",
    name: "price-watch",
    source: "self",
    status: "drafting",
    detail: "Self-creating. Polls product pages on paired machines and diffs prices.",
  },
];

export const VOICE_PRESETS: { name: string; voice: string; persona: string }[] = VOICE_PERSONAS.map(
  (p) => ({ name: p.name, voice: p.voice, persona: p.persona })
);

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
  instances: SSHInstance[];
  tunnels: TunnelMachine[];
  voice: VoiceSettings;
  skills: AgentSkill[];
  whitelist: WhitelistUser[];
  /** UI language: en / ru / he (he flips the app to RTL) */
  uiLang: Lang;
  /** activated agent preset (presets library), null = no preset */
  activePreset: string | null;
  /** enabled cognition packs (Hermes / Moltis brains) */
  brains: BrainConfig;
  /** Active-brain chooser — provider id that answers FIRST in the fallback
   *  chain (null = pure priority order). Synced to the Telegram gateway via
   *  the Active-Brain passport (/api/agent/config), where /model taps set
   *  the same field on the server-side agent. */
  activeProviderId: string | null;

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
  addInstance: (i: SSHInstance) => void;
  updateInstance: (id: string, patch: Partial<SSHInstance>) => void;
  removeInstance: (id: string) => void;
  addTunnel: (t: TunnelMachine) => void;
  updateTunnel: (id: string, patch: Partial<TunnelMachine>) => void;
  removeTunnel: (id: string) => void;
  setVoice: (v: Partial<VoiceSettings>) => void;
  addSkill: (s: AgentSkill) => void;
  updateSkill: (id: string, patch: Partial<AgentSkill>) => void;
  addWhitelistUser: (w: WhitelistUser) => void;
  removeWhitelistUser: (id: string) => void;
  updateWhitelistUser: (id: string, patch: Partial<WhitelistUser>) => void;
  setUiLang: (l: Lang) => void;
  /** Active-brain chooser: pick which provider/model answers first
   *  (null = auto, priority order). Persists locally and pushes the
   *  choice to the server-side gateway agent (best-effort). */
  setActiveProvider: (id: string | null) => void;
  /** activate/deactivate a preset: updates local state, the merged system
   *  prompt and the server-side gateway agent (best-effort API push) */
  activatePreset: (id: string | null) => Promise<{ ok: boolean; error?: string }>;
  /** toggle a cognition pack (Hermes / Moltis brain): updates local state and
   *  pushes the config to the server-side gateway agent (best-effort) */
  setBrain: (id: BrainId, on: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** generates portal credentials + owner pairing token (wizard step 1) */
  ensureCredentials: () => void;
  /** rotate portal credentials from the lock screen: mints a NEW username
   *  (+ optional custom slug) and access token, replacing the old pair.
   *  pairingToken is intentionally left untouched so the Telegram gateway
   *  binding survives a credential rotation. */
  regeneratePortalCredentials: (username?: string) => void;
  resetAll: () => void;
  setHydrated: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export { uid, genPairingToken, genPortalToken, slugifyUser };

/* ---------------- Voice Persona Passport — portal → gateway sync ---------------- */

const VOICE_SYNC_DEBOUNCE_MS = 900;
let voiceSyncTimer: ReturnType<typeof setTimeout> | null = null;
let providerSyncTimer: ReturnType<typeof setTimeout> | null = null;

/** Serialized provider payload for the gateway (id/priority are local-only). */
function providersForGateway(providers: AIProvider[]) {
  return [...providers]
    .sort((a, b) => a.priority - b.priority)
    .map((p) => ({
      label: p.label,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      compat: p.compat,
    }));
}

/**
 * Push provider changes (add / edit / remove / reorder) to the server-side
 * gateway agent. Before this existed, the Telegram bot kept the
 * pairing-time provider snapshot forever: a custom provider added in the
 * portal was silently ignored and the bot kept answering from the demo
 * brain while telling the user to "add your own provider key".
 * Best-effort like the voice/preset sync; debounced for bursts.
 */
function scheduleProviderGatewaySync(): void {
  if (typeof window === "undefined") return;
  if (providerSyncTimer) clearTimeout(providerSyncTimer);
  providerSyncTimer = setTimeout(async () => {
    providerSyncTimer = null;
    const s = useDeepInit.getState();
    const ownerToken = s.profile.pairingToken;
    if (!ownerToken) return; // local-only until paired
    try {
      await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerToken, providers: providersForGateway(s.providers) }),
      });
    } catch {
      /* best-effort — the console still works locally */
    }
  }, VOICE_SYNC_DEBOUNCE_MS);
}

/**
 * Push the web picker's voice persona (and rate/pitch) to the server-side
 * gateway agent so Telegram voice notes sound EXACTLY like the console.
 * Best-effort like the preset/brain sync; debounced for the sliders.
 */
function scheduleVoiceGatewaySync(): void {
  if (typeof window === "undefined") return;
  if (voiceSyncTimer) clearTimeout(voiceSyncTimer);
  voiceSyncTimer = setTimeout(async () => {
    voiceSyncTimer = null;
    const s = useDeepInit.getState();
    const ownerToken = s.profile.pairingToken;
    if (!ownerToken) return; // local-only until paired
    try {
      await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerToken,
          voiceId: s.voice.voice,
          voiceRate: s.voice.rate,
          voicePitch: s.voice.pitch,
        }),
      });
    } catch {
      /* best-effort — the picker still works locally */
    }
  }, VOICE_SYNC_DEBOUNCE_MS);
}

const defaultQuestionnaire: Questionnaire = {
  goals: [],
  autonomy: "suggested",
  personality: "friendly",
  schedule: "247",
  customHours: "",
  language: "English",
  notes: "",
};

const defaultVoice: VoiceSettings = {
  enabled: true,
  autoSpeak: false,
  voice: "en-US-AvaNeural",
  rate: 0,
  pitch: 0,
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
      instances: [],
      tunnels: [],
      voice: defaultVoice,
      skills: BUILTIN_SKILLS,
      whitelist: [],
      uiLang: "en",
      activePreset: null,
      brains: { hermes: false, moltis: false },
      activeProviderId: null,

      setHydrated: () => set({ hydrated: true }),
      setView: (view) => set({ view }),
      setWizardStep: (wizardStep) => set({ wizardStep }),
      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),

      addChannel: (c) => set((s) => ({ channels: [...s.channels.filter((x) => x.type !== c.type), c] })),
      updateChannel: (id, patch) =>
        set((s) => ({ channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeChannel: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),

      addProvider: (p) =>
        set((s) => {
          scheduleProviderGatewaySync();
          return { providers: [...s.providers, p] };
        }),
      updateProvider: (id, patch) =>
        set((s) => {
          scheduleProviderGatewaySync();
          return { providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
        }),
      removeProvider: (id) =>
        set((s) => {
          scheduleProviderGatewaySync();
          return {
            providers: s.providers.filter((p) => p.id !== id),
            // the active pick must keep pointing at an existing brain
            activeProviderId: s.activeProviderId === id ? null : s.activeProviderId,
          };
        }),
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
          scheduleProviderGatewaySync();
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

      addInstance: (i) => set((s) => ({ instances: [...s.instances, i] })),
      updateInstance: (id, patch) =>
        set((s) => ({ instances: s.instances.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      removeInstance: (id) => set((s) => ({ instances: s.instances.filter((i) => i.id !== id) })),

      addTunnel: (t) => set((s) => ({ tunnels: [...s.tunnels.filter((x) => x.id !== t.id), t] })),
      updateTunnel: (id, patch) =>
        set((s) => ({ tunnels: s.tunnels.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      removeTunnel: (id) => set((s) => ({ tunnels: s.tunnels.filter((t) => t.id !== id) })),

      setVoice: (v) => {
        set((s) => ({ voice: { ...s.voice, ...v } }));
        // Voice Persona Passport — push the sound of the agent to the
        // Telegram gateway (best-effort, same pattern as preset/brain sync).
        // Rate/pitch sliders fire rapidly → debounced.
        if (v.voice !== undefined || v.rate !== undefined || v.pitch !== undefined) {
          scheduleVoiceGatewaySync();
        }
      },
      addSkill: (sk) => set((s) => ({ skills: [...s.skills, sk] })),
      updateSkill: (id, patch) =>
        set((s) => ({ skills: s.skills.map((sk) => (sk.id === id ? { ...sk, ...patch } : sk)) })),

      addWhitelistUser: (w) => set((s) => ({ whitelist: [...s.whitelist, w] })),
      removeWhitelistUser: (id) =>
        set((s) => ({ whitelist: s.whitelist.filter((w) => w.id !== id) })),
      updateWhitelistUser: (id, patch) =>
        set((s) => ({ whitelist: s.whitelist.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),

      setUiLang: (l) => set({ uiLang: l }),

      setActiveProvider: (id) => {
        set({ activeProviderId: id });
        const s = get();
        const picked = id ? s.providers.find((p) => p.id === id) : null;
        s.logActivity({
          kind: "provider",
          title: picked ? `Active brain: ${picked.label}` : "Active brain: auto (priority order)",
          detail: picked ? `${picked.model} answers first — synced to Telegram (/model)` : "the fallback chain runs in priority order",
        });
        // Active-Brain passport — push the choice to the gateway agent so
        // Telegram (/model) and the console agree on who answers first.
        // Immediate (not debounced): a single deliberate tap, like preset/brain sync.
        const ownerToken = s.profile.pairingToken;
        if (!ownerToken || typeof window === "undefined") return; // local-only until paired
        void fetch("/api/agent/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerToken, activeProvider: picked ? providerKey(picked) : null }),
        }).catch(() => {
          /* best-effort — the picker still works locally */
        });
      },

      activatePreset: async (id) => {
        const preset = getPreset(id);
        if (id && !preset) return { ok: false, error: "Unknown preset" };
        const s = get();
        set({ activePreset: id });
        const merged = buildSystemPrompt(
          s.profile,
          s.questionnaire,
          s.channels,
          s.tools,
          s.instances,
          s.tunnels,
          s.skills,
          preset ?? undefined
        );
        s.logActivity({
          kind: "system",
          title: preset ? `Preset activated: ${preset.emoji} ${id}` : "Preset deactivated — running base config",
        });
        const ownerToken = s.profile.pairingToken;
        if (!ownerToken) return { ok: true }; // local-only until paired
        try {
          const res = await fetch("/api/agent/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerToken, presetId: id, systemPrompt: merged }),
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok || !data.ok) {
            return { ok: false, error: data.error || `HTTP ${res.status}` };
          }
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },

      setBrain: async (id, on) => {
        const current = normalizeBrainConfig(get().brains);
        const next = { ...current, [id]: on };
        set({ brains: next });
        get().logActivity({
          kind: "system",
          title: on ? `Brain enabled: ${id}` : `Brain disabled: ${id}`,
        });
        const ownerToken = get().profile.pairingToken;
        if (!ownerToken) return { ok: true }; // local-only until paired
        try {
          const res = await fetch("/api/agent/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerToken, brains: next }),
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },

      ensureCredentials: () =>
        set((s) => {
          const patch: Partial<UserProfile> = {};
          if (!s.profile.portalUser) patch.portalUser = slugifyUser(s.profile.displayName || "operator");
          if (!s.profile.portalToken) patch.portalToken = genPortalToken();
          if (!s.profile.pairingToken) patch.pairingToken = genPairingToken();
          return { profile: { ...s.profile, ...patch } };
        }),

      regeneratePortalCredentials: (username) =>
        set((s) => ({
          profile: {
            ...s.profile,
            portalUser: slugifyUser(username || s.profile.displayName || "operator"),
            portalToken: genPortalToken(),
          },
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
          instances: [],
          tunnels: [],
          voice: defaultVoice,
          skills: BUILTIN_SKILLS,
          whitelist: [],
          // language preference survives a factory reset
          uiLang: get().uiLang,
          activeProviderId: null,
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
        instances: s.instances,
        tunnels: s.tunnels,
        voice: s.voice,
        skills: s.skills,
        whitelist: s.whitelist,
        uiLang: s.uiLang,
        activePreset: s.activePreset,
        brains: s.brains,
        activeProviderId: s.activeProviderId,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);

/* end of store */

/* ---------- Agent system prompt builder ---------- */

export function buildSystemPrompt(
  profile: UserProfile,
  q: Questionnaire,
  channels: MessagingChannel[],
  tools: AgentTool[],
  instances: SSHInstance[] = [],
  tunnels: TunnelMachine[] = [],
  skills: AgentSkill[] = [],
  preset?: AgentPreset
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
  const onlineTunnels = tunnels.filter((t) => t.status === "online" || t.status === "stale");
  const armedSkills = skills.filter((s) => s.status === "armed");

  const instanceBlock = [
    ...instances.map(
      (i) =>
        `- SSH "${i.name}" → ${i.username}@${i.host}:${i.port}${i.sysinfo?.os ? ` (${i.sysinfo.os.split(" ").slice(0, 3).join(" ")})` : ""}`
    ),
    ...onlineTunnels.map(
      (t) => `- TUNNEL "${t.name}" → machine ${t.hostname || t.id} (${t.os}) — commands can be pushed through the pair tunnel`
    ),
  ].join("\n");

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

    instanceBlock
      ? `VIRTUAL INSTANCES (machines you control):\n${instanceBlock}\nWhen a task exceeds your own cloud environment — user-local files, desktop apps, hardware, network-limited resources — route it to a paired machine over SSH or the pair tunnel, then report the results.`
      : `No machines are paired yet. If a task needs one, tell the user to pair a machine from the Instances tab.`,

    armedSkills.length
      ? `SKILL REGISTRY (armed):\n${armedSkills.map((s) => `- ${s.name}: ${s.detail}`).join("\n")}\nApply these skills automatically when relevant; write and register new ones when a task needs a skill that doesn't exist yet.`
      : "",

    `BUILD PROTOCOL — zcode-smart-skill v2 (GVS5H), armed for every hard build/debug/design task:`,
    `1. PLAN before code: restate the problem, acceptance criteria, and 3-6 independently verifiable tasks (tag each easy|medium|hard).`,
    `2. ADVERSARIAL TEST-SPEC first for medium/hard tasks: write the edge-case and invariant tests the artifact must pass BEFORE implementing.`,
    `3. WORK with handoff discipline: one task at a time, distinct approaches (not variations), self-attack: list 3 ways your solution could be wrong and check them.`,
    `4. VERIFY by actually running the code/tests — a failed verify overrides any "done".`,
    `5. ANTI-STUCK: after 2 failed attempts on one approach, switch or race a genuinely different approach; never polish a dead idea. On success, distill a reusable 3-6 line workflow.`,

    q.notes ? `Personal context from the user: ${q.notes}` : "",
    preset ? presetPromptBlock(preset.id) : "",
  ]
    .filter(Boolean)
    .join("\n");
}
