/* Parity + presets tests — run with: npx tsx scripts/test-parity.ts
 * Covers: presets library integrity + i18n coverage, agent memory
 * (remember/recall), reminders (add/due/mark), guardrails tool manual,
 * preset-aware system prompts, graceful tool errors without gateway ctx.
 */
import { translate } from "../src/lib/i18n";
import {
  registerAgent,
  rememberFact,
  searchMemory,
  addReminder,
  dueReminders,
  markRemindersDone,
  findAgentByOwner,
  serializeForTest,
} from "../src/lib/agent-registry";
import { PRESETS, getPreset, presetPromptBlock, PRESET_IDS } from "../src/lib/presets";
import { buildSystemPrompt } from "../src/lib/store";
import { AGENT_GUARDRAILS, executeToolCall } from "../src/lib/tools";
import type { Questionnaire } from "../src/lib/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  /* 1. presets library */
  check("presets: 8 defined", PRESETS.length === 8, String(PRESETS.length));
  check("presets: unique ids", new Set(PRESET_IDS).size === PRESETS.length);
  for (const p of PRESETS) {
    check(
      `preset ${p.id}: prompt + starters + i18n`,
      p.prompt.length > 120 &&
        p.starters.length >= 2 &&
        p.caps.length >= 2 &&
        Boolean(getPreset(p.id))
    );
    for (const lang of ["en", "ru", "he"] as const) {
      const name = translate(lang, `preset.${p.id}.name`);
      check(
        `preset ${p.id}: ${lang} name/tag translated`,
        name !== `preset.${p.id}.name` && Boolean(translate(lang, `preset.${p.id}.tag`)),
        name
      );
    }
    check(`preset ${p.id}: block mentions id`, presetPromptBlock(p.id).includes(p.id));
  }

  /* 2. preset-aware system prompt */
  const q: Questionnaire = {
    goals: ["research"],
    autonomy: "suggested",
    personality: "friendly",
    schedule: "247",
    language: "English",
    notes: "",
  };
  const base = buildSystemPrompt(
    { displayName: "Roman", agentName: "Init", timezone: "UTC" },
    q,
    [],
    []
  );
  const withPreset = buildSystemPrompt(
    { displayName: "Roman", agentName: "Init", timezone: "UTC" },
    q,
    [],
    [],
    [],
    [],
    [],
    getPreset("coder")
  );
  check("prompt: base has no preset block", !base.includes("ACTIVE PRESET"));
  check("prompt: preset block injected", withPreset.includes("ACTIVE PRESET") && withPreset.includes("Code"));

  /* 3. agent memory */
  const agent = registerAgent({
    key: "test:PARITY",
    botToken: "1:test",
    builtIn: true,
    agentName: "Parity",
    ownerName: "Roman",
    ownerToken: "DIP-PAR1-TEST",
    systemPrompt: "test",
    providers: [],
    allowDemoBrain: true,
    whitelist: [],
  });
  rememberFact(agent, "Roman prefers meetings after 14:00");
  rememberFact(agent, "Project rommark.dev uses Next.js 16");
  rememberFact(agent, "Bank call scheduled Tuesday");
  check("memory: stored 3", (agent.memory?.length ?? 0) === 3);
  check("memory: query hit", searchMemory(agent, "meetings").some((m) => m.text.includes("14:00")));
  check("memory: query multi-token", searchMemory(agent, "nextjs project").some((m) => m.text.includes("Next.js")));
  check("memory: latest first, capped", searchMemory(agent, "")[0]?.text.includes("Bank") === true);

  /* 4. reminders */
  addReminder(agent, { chatId: 42, text: "call bank", dueAt: Date.now() - 60_000 });
  addReminder(agent, { chatId: 42, text: "future task", dueAt: Date.now() + 600_000 });
  const due = dueReminders(agent);
  check("reminders: only past-due", due.length === 1 && due[0].text === "call bank");
  markRemindersDone(agent, due.map((r) => r.id));
  check("reminders: marked done", dueReminders(agent).length === 0);

  /* 5. owner lookup + serialization defaults */
  check("registry: find by owner token", findAgentByOwner("dip-par1-test")?.agentName === "Parity");
  const snapshot = serializeForTest();
  const raw = JSON.stringify(snapshot);
  check("registry: memory persisted", raw.includes("meets meetings after") || raw.includes("14:00"));
  check("registry: reminders persisted", raw.includes("future task"));

  /* 6. guardrails advertise the full toolset */
  for (const tool of ["web_search", "web_fetch", "image_search", "image_gen", "tts", "remember", "recall", "remind"]) {
    check(`guardrails: advertises ${tool}`, AGENT_GUARDRAILS.includes(tool));
  }

  /* 7. gateway-scoped tools degrade gracefully without ctx */
  const memErr = await executeToolCall({ name: "remember", params: { text: "x" } });
  check("tools: remember without ctx → graceful", memErr.includes("gateway"));
  const remindErr = await executeToolCall({ name: "remind", params: { text: "x", when: "in 5 minutes" } });
  check("tools: remind without ctx → graceful", remindErr.includes("gateway"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

void main();
