/* Tool-mute auto-retry test — reproduces the production report
 * ("The agent executed tool calls but returned no text answer.") and proves
 * the engine now recovers by itself:
 *   1. non-streaming: model tool-mute on every round → pending calls get
 *      executed at the cap, ANSWER_NUDGE forces a text answer → REAL answer
 *   2. non-streaming: if even NUDGE_RETRIES nudged replies stay tool-mute,
 *      the honest notice is returned (no infinite loop)
 *   3. streaming: same recovery, deltas carry the final answer
 *   4. streaming: exhausted path returns the notice
 *   5. regression: plain-text replies take the fast path (1 request)
 *   6. regression: visible text + calls at the cap → text returned, no nudge
 * Run: npx tsx scripts/test-nudge-retry.ts
 */
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  runAgentChain,
  runAgentChainStreaming,
  NO_TEXT_ANSWER,
  NUDGE_RETRIES,
  MAX_TOOL_ROUNDS,
} from "../src/lib/brain";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const TOOL_ONLY = [
  "```tool_call",
  '{"tool": "calc", "arguments": {"expression": "6*7"}}',
  "```",
].join("\n");
const TEXT_REPLY = "Final answer: 6 times 7 equals 42. Anything else?";

type Mode = "recover" | "dead" | "text" | "mixed";
const PORT = 8951;
let mode: Mode = "recover";
let requests = 0;
let lastNudgeHadToolResult = false;

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/v1/chat/completions") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests++;
      const parsed = JSON.parse(body) as {
        stream?: boolean;
        messages: { role: string; content: string }[];
      };
      const last = parsed.messages.at(-1)!;
      const nudged = last.role === "user" && last.content.includes("TOOL PHASE OVER");
      if (nudged) lastNudgeHadToolResult = last.content.includes("42");

      const reply =
        mode === "text" || (mode === "recover" && nudged)
          ? TEXT_REPLY
          : mode === "mixed"
            ? `Working on it.\n\n${TOOL_ONLY}`
            : TOOL_ONLY;

      if (parsed.stream === true) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunks = reply.match(/[\s\S]{1,24}/g) || [reply];
        for (const c of chunks) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }));
      }
    });
    return;
  }
  res.writeHead(404).end();
});

async function main() {
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
const providers = [
  { id: "p1", label: "toolmute-mock", baseUrl: base, apiKey: "", model: "mock-model", compat: "openai" as const },
];
const messages = [{ role: "user" as const, content: "What is 6 times 7?" }];

/* ── 1. non-streaming: recovers after the nudge ─────────────────────────── */
mode = "recover";
requests = 0;
lastNudgeHadToolResult = false;
const r1 = await runAgentChain({ providers, messages, allowDemoBrain: false });
check("1a. recovered with a real answer", r1.ok && r1.content === TEXT_REPLY, r1.content || r1.error || "");
check("1b. no honest-notice in the answer", !r1.content?.includes("no text answer"), r1.content || "");
check("1c. nudge carried executed tool results", lastNudgeHadToolResult);
check(
  `1d. request count = ${MAX_TOOL_ROUNDS + 1} rounds + 1 nudge`,
  requests === MAX_TOOL_ROUNDS + 1 + 1,
  String(requests)
);

/* ── 2. non-streaming: retries exhausted → honest notice, no infinite loop ── */
mode = "dead";
requests = 0;
const r2 = await runAgentChain({ providers, messages, allowDemoBrain: false });
check("2a. exhausted path returns the notice", r2.ok && r2.content === NO_TEXT_ANSWER, r2.content || r2.error || "");
check(
  `2b. exactly ${NUDGE_RETRIES} retries (no runaway loop)`,
  requests === MAX_TOOL_ROUNDS + 1 + NUDGE_RETRIES,
  String(requests)
);

/* ── 3. streaming: recovers after the nudge, deltas carry the answer ────── */
mode = "recover";
requests = 0;
const deltas: string[] = [];
const r3 = await runAgentChainStreaming({
  providers,
  messages,
  allowDemoBrain: false,
  onEvent: (ev) => {
    if (ev.type === "delta") deltas.push(ev.text);
  },
});
check("3a. streaming recovered with a real answer", r3.ok && r3.content === TEXT_REPLY, r3.content || r3.error || "");
check("3b. deltas contain the answer", deltas.some((d) => d.includes("42")), deltas.at(-1) || "(none)");
check("3c. no tool syntax leaked into deltas", deltas.every((d) => !d.includes("tool_call")), deltas.at(-1) || "");
check("3d. request count = 3 rounds + 1 nudge", requests === 4, String(requests));

/* ── 4. streaming: exhausted path ───────────────────────────────────────── */
mode = "dead";
requests = 0;
const r4 = await runAgentChainStreaming({ providers, messages, allowDemoBrain: false });
check("4a. streaming exhausted path returns the notice", r4.ok && r4.content === NO_TEXT_ANSWER, r4.content || r4.error || "");
check("4b. exactly NUDGE_RETRIES retries", requests === MAX_TOOL_ROUNDS + 1 + NUDGE_RETRIES, String(requests));

/* ── 5. regression: plain-text replies untouched ────────────────────────── */
mode = "text";
requests = 0;
const r5 = await runAgentChain({ providers, messages, allowDemoBrain: false });
check("5a. plain text passes through", r5.ok && r5.content === TEXT_REPLY, r5.content || r5.error || "");
check("5b. single request, no retries", requests === 1, String(requests));

/* ── 6. regression: visible text at the cap → returned, no nudge ────────── */
mode = "mixed";
requests = 0;
const r6 = await runAgentChain({ providers, messages, allowDemoBrain: false });
check("6a. visible text wins at the cap", r6.ok && r6.content === "Working on it.", r6.content || r6.error || "");
check("6b. no nudge requests fired", requests === MAX_TOOL_ROUNDS + 1, String(requests));

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
