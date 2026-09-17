/* Agent brains tests — run with: npx tsx scripts/test-brains.ts
 * Covers: brain registry & prompt composition (off / hermes / moltis / both),
 * the Moltis fenced-JSON tool dialect (parse + sanitize + stream-safe),
 * the calc engine (incl. injection refusal), brain tool-name routing,
 * and offline e2e agentic loops proving the brain prompt lands in the
 * system message and brain tool calls really execute — classic + streaming.
 */
import * as http from "node:http";
import {
  BRAINS,
  BRAIN_STARTERS,
  brainPromptBlock,
  brainSignature,
  brainToolCatalog,
  enabledBrains,
  getBrain,
  normalizeBrainConfig,
} from "../src/lib/brains";
import { executeToolCall, extractToolCalls, sanitizeAgentText, sanitizeStreamText } from "../src/lib/tools";
import { runAgentChain, runAgentChainStreaming } from "../src/lib/brain";

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

/* build a Qwen-style sample without ever writing the literal opener tag
   (transport layers strip it) */
const TOOL_CALL_TAG = "<" + "tool_call>";

async function main() {
  /* ---------- 1. registry & prompt composition ---------- */
  check("registry: two brains", BRAINS.length === 2 && !!getBrain("hermes") && !!getBrain("moltis"));
  check("registry: hermes source", getBrain("hermes")?.source === "https://github.com/NousResearch/hermes-agent");
  check("registry: moltis source", getBrain("moltis")?.source === "https://github.com/moltis-org/moltis");
  check("registry: studiedAt pins commits", /5b80838/.test(getBrain("hermes")?.studiedAt || "") && /9d3238c/.test(getBrain("moltis")?.studiedAt || ""));

  check("compose: off = empty", brainPromptBlock({ hermes: false, moltis: false }) === "" && brainPromptBlock(undefined) === "");
  const h = brainPromptBlock({ hermes: true });
  check("compose: hermes identity", h.includes("Hermes brain") && h.includes("hermes-agent"), h.slice(0, 80));
  check("compose: hermes enforcement", h.includes("Tool-use enforcement") && h.includes("MUST use your tools"));
  check("compose: hermes finish-the-job", h.includes("Finishing the job") && h.includes("NEVER substitute plausible-looking fabricated output"));
  check("compose: hermes parallel + memory", h.includes("Parallel tool calls") && h.includes("declarative facts, not instructions"));
  const m = brainPromptBlock({ moltis: true });
  check("compose: moltis soul", m.includes("SOUL.md") && m.includes("Be genuinely helpful, not performatively helpful"));
  check("compose: moltis guidelines", m.includes("Do not call tools for greetings"));
  check("compose: moltis dialect taught", m.includes("tool_call") && m.includes('"tool": "web_search"'));
  const both = brainPromptBlock({ hermes: true, moltis: true });
  check("compose: hybrid note", both.includes("HYBRID BRAINS ACTIVE") && both.includes("Hermes brain") && both.includes("Moltis brain"));
  check("compose: both = hermes + moltis blocks", both.includes("Tool-use enforcement") && both.includes("SOUL.md"));

  check("normalize: strings are not bools", normalizeBrainConfig({ hermes: "yes" as unknown as boolean }).hermes === false);
  check("normalize: undefined → false,false", normalizeBrainConfig(null).hermes === false && normalizeBrainConfig(null).moltis === false);
  check("signature: empty", brainSignature({}) === "");
  check("signature: both", brainSignature({ hermes: true, moltis: true }) === "hermes+moltis");
  check("signature: one", brainSignature({ moltis: true }) === "moltis");
  check("catalog: merges + dedupes", (() => {
    const cat = brainToolCatalog({ hermes: true, moltis: true });
    return cat.includes("web_extract") && cat.includes("calc") && new Set(cat).size === cat.length;
  })());
  check("starters: both brains have prompts", BRAIN_STARTERS.hermes.length >= 3 && BRAIN_STARTERS.moltis.length >= 3);
  check("enabledBrains order stable", JSON.stringify(enabledBrains({ hermes: true, moltis: true }).map((b) => b.id)) === '["hermes","moltis"]');

  /* ---------- 2. Moltis fenced-JSON dialect ---------- */
  const moltisBlock = [
    "I'll compute that with the calc engine.",
    "",
    "```tool_call",
    '{"tool": "calc", "arguments": {"expression": "6*7"}}',
    "```",
    "",
    "Then I'll summarize.",
  ].join("\n");
  const ex1 = extractToolCalls(moltisBlock);
  check("moltis: one call parsed", ex1.calls.length === 1, JSON.stringify(ex1.calls));
  check("moltis: name=calc", ex1.calls[0]?.name === "calc");
  check("moltis: expression param", ex1.calls[0]?.params.expression === "6*7");
  check("moltis: prose preserved", ex1.cleaned.includes("I'll compute that") && ex1.cleaned.includes("Then I'll summarize"));
  check("moltis: fence removed", !ex1.cleaned.includes("```tool_call"));

  const two = '```tool_call\n{"tool": "remember", "arguments": {"text": "a"}}\n```\nmiddle\n```tool_call\n{"tool": "recall", "args": {"query": "b"}}\n```';
  const ex2 = extractToolCalls(two);
  check("moltis: two calls", ex2.calls.length === 2 && ex2.calls[0].name === "remember" && ex2.calls[1].name === "recall", JSON.stringify(ex2.calls));
  check("moltis: args alias accepted", ex2.calls[1]?.params.query === "b");

  const coerced = '```tool_call\n{"tool": "calc", "arguments": {"expression": "1+1", "precision": 12, "exact": true}}\n```';
  check("moltis: number/bool coerced", extractToolCalls(coerced).calls[0]?.params.precision === "12" && extractToolCalls(coerced).calls[0]?.params.exact === "true");

  const bad = '```tool_call\nnot json at all\n```';
  const exBad = extractToolCalls(bad);
  check("moltis: malformed → no call, fence cleaned", exBad.calls.length === 0 && !exBad.cleaned.includes("```tool_call"));

  const qwen = `${TOOL_CALL_TAG}{"name": "web_search", "arguments": {"query": "regression"}}${"<"}/tool_call>`;
  const exQ = extractToolCalls(qwen);
  check("regression: qwen dialect still parses", exQ.calls.length === 1 && exQ.calls[0].name === "web_search" && exQ.calls[0].params.query === "regression");

  const fun = "<function=calc>\n<parameter=expression>2+2</parameter>\n</function>";
  check("regression: hermes-style <function= still parses", extractToolCalls(fun).calls[0]?.name === "calc");

  check("sanitize: unterminated moltis fence cut", !sanitizeAgentText("Answer so far\n```tool_call\n{\"tool\": \"calc\"").includes("tool_call"));
  let fenceLeak = false;
  const drip = "Done.\n```tool_call\n{\"tool\": \"calc\", \"arguments\": {\"expression\": \"1\"";
  for (let i = 1; i <= drip.length; i++) {
    if (sanitizeStreamText(drip.slice(0, i)).includes("```tool_call")) {
      fenceLeak = true;
      break;
    }
  }
  check("stream: no moltis fence visible at ANY prefix", !fenceLeak);
  check("sanitize: normal code fence untouched", sanitizeAgentText("```js\nconst a = 1;\n```") === "```js\nconst a = 1;\n```");

  /* ---------- 3. calc engine ---------- */
  const calc = async (expr: string) => await executeToolCall({ name: "calc", params: { expression: expr } });
  check("calc: order of ops", (await calc("2+2*3")) === "calc(2+2*3) = 8");
  check("calc: parens + unary minus", (await calc("-(3+4)*2")).includes("= -14"));
  check("calc: right-assoc power", (await calc("2^3^2")).includes("= 512"));
  check("calc: sqrt/round", (await calc("round(sqrt(2)*100)")).includes("= 141"));
  check("calc: pi constant", (await calc("round(pi*100)")).includes("= 314"));
  check("calc: min/max", (await calc("min(4,2,9)+max(1,5)")).includes("= 7"));
  check("calc: percent pattern", (await calc("(17.5/100)*2384*12")).includes("= 5006.4"));
  check("calc: underscores stripped", (await calc("1_000 + 234")).includes("= 1234"));
  check("calc: floats", (await calc("0.1+0.2")).includes("= 0.3"));
  const div0 = await calc("5/0");
  check("calc: division by zero → error", div0.startsWith("calc error"), div0);
  const inj1 = await calc("process");
  check("calc: identifier injection refused", inj1.startsWith("calc error") && inj1.includes("unknown identifier"), inj1);
  const inj2 = await calc("2+import('fs')");
  check("calc: code injection refused", inj2.startsWith("calc error"), inj2);
  check("calc: no params → error", (await executeToolCall({ name: "calc", params: {} })).startsWith("calc error"));
  check("calc: alias 'calculator' routes", (await executeToolCall({ name: "calculator", params: { expression: "2+2" } })).includes("= 4"));

  /* ---------- 4. brain tool-name routing (deterministic, offline) ---------- */
  const r1 = await executeToolCall({ name: "memory_save", params: { text: "x" } });
  check("route: memory_save → remember", r1.includes("only available in gateway"), r1);
  const r2 = await executeToolCall({ name: "memory_forget", params: { query: "x" } });
  check("route: memory_forget → forget", r2.includes("only available in gateway"), r2);
  const r3 = await executeToolCall({ name: "memory_recall", params: {} });
  check("route: memory_recall → recall", r3.includes("only available in gateway"), r3);
  const r4 = await executeToolCall({ name: "exec", params: { command: "rm -rf /" } });
  check("route: exec → safe refusal", r4.includes("no shell") && r4.includes("rm -rf /"), r4);
  check("route: bash alias refused too", (await executeToolCall({ name: "bash", params: { command: "ls" } })).includes("no shell"));
  const r5 = await executeToolCall({ name: "todo_list", params: {} });
  check("route: todo_list agent-scoped", r5.includes("agent-scoped"), r5);
  const r6 = await executeToolCall({ name: "vision_analyze", params: {} });
  check("route: vision_analyze needs url", r6.includes("no image url"), r6);
  const r7 = await executeToolCall({ name: "cron", params: { when: "in 5 minutes", text: "ping" } });
  check("route: cron → remind", r7.includes("only available in gateway"), r7);
  const r8 = await executeToolCall({ name: "cronjob_manage", params: { action: "list" } });
  check("route: cronjob_manage → remind path", r8.includes("gateway") || r8.includes("remind"), r8);
  const r9 = await executeToolCall({ name: "web_extract", params: { url: "not-a-url" } });
  check("route: web_extract → web_fetch validation", r9.includes("no valid http"), r9);

  /* ---------- 5. offline e2e: brains land in prompt + tools execute ---------- */
  const PORT = 8931;
  let seenSystem = "";
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url.startsWith("/v1/chat/completions") && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body) as {
          stream?: boolean;
          messages: { role: string; content: string }[];
        };
        seenSystem = parsed.messages.find((mm) => mm.role === "system")?.content ?? "";
        const last = parsed.messages.at(-1)!;
        const wantStream = parsed.stream === true;
        const finish = (content: string) => {
          if (!wantStream) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
            return;
          }
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          // emit the answer in small SSE chunks
          const chunks = content.match(/[\s\S]{1,24}/g) || [content];
          for (const c of chunks) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
          }
          res.write("data: [DONE]\n\n");
          res.end();
        };
        if (last.role === "user" && last.content.includes("AUTOMATED TOOL RESULTS")) {
          const got42 = last.content.includes("calc(6*7) = 42");
          finish(got42
            ? "The calc tool returned **42** — the answer to everything, verified by execution."
            : "I ran the tool but the result did not come back.");
        } else {
          finish([
            "One moment, computing precisely.",
            "",
            "```tool_call",
            '{"tool": "calc", "arguments": {"expression": "6*7"}}',
            "```",
          ].join("\n"));
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  const base = `http://127.0.0.1:${PORT}/v1`;
  const providers = [{ id: "p1", label: "moltis-mock", baseUrl: base, apiKey: "", model: "text-tool-model", compat: "openai" as const }];
  const messages = [{ role: "user" as const, content: "What is 6 times 7? Use the calc tool." }];

  // 5a. classic loop, moltis brain ON
  seenSystem = "";
  const c1 = await runAgentChain({ providers, messages, brains: { moltis: true }, allowDemoBrain: false });
  check("e2e classic: ok", c1.ok && !!c1.content, c1.error);
  check("e2e classic: tool executed (42 in answer)", /42/.test(c1.content || ""), c1.content);
  check("e2e classic: no moltis fence leaks", !(c1.content || "").includes("```tool_call"));
  check("e2e classic: system got moltis brain", seenSystem.includes("Moltis brain") && seenSystem.includes("SOUL.md"));

  // 5b. streaming loop, moltis brain ON
  seenSystem = "";
  const deltas: string[] = [];
  const s1 = await runAgentChainStreaming({
    providers,
    messages,
    brains: { moltis: true },
    allowDemoBrain: false,
    onEvent: (ev) => {
      if (ev.type === "delta") deltas.push(ev.text);
    },
  });
  check("e2e stream: ok", s1.ok && !!s1.content, s1.error);
  check("e2e stream: deltas flowed", deltas.length >= 2, `n=${deltas.length}`);
  check("e2e stream: monotonic", deltas.every((d, i) => i === 0 || deltas[i - 1].length <= d.length));
  check("e2e stream: final clean + 42", /42/.test(s1.content || "") && !(s1.content || "").includes("```tool_call"), s1.content);
  check("e2e stream: system got moltis brain", seenSystem.includes("tool_call") && seenSystem.includes("Moltis brain"));

  // 5c. hermes brain ON — hermes-style <function= dialect + identity in prompt
  seenSystem = "";
  const c2 = await runAgentChain({
    providers,
    messages,
    brains: { hermes: true },
    allowDemoBrain: false,
  });
  check("e2e hermes: ok + 42", c2.ok && /42/.test(c2.content || ""), c2.content);
  check("e2e hermes: system got hermes brain", seenSystem.includes("Hermes brain") && seenSystem.includes("Tool-use enforcement"));
  check("e2e hermes: no hybrid note", !seenSystem.includes("HYBRID"));

  // 5d. both ON — hybrid
  seenSystem = "";
  const c3 = await runAgentChain({ providers, messages, brains: { hermes: true, moltis: true }, allowDemoBrain: false });
  check("e2e both: ok + 42", c3.ok && /42/.test(c3.content || ""), c3.content);
  check("e2e both: hybrid prompt", seenSystem.includes("HYBRID BRAINS ACTIVE") && seenSystem.includes("Hermes brain") && seenSystem.includes("Moltis brain"));

  // 5e. none — plain guardrails only
  seenSystem = "";
  const c4 = await runAgentChain({ providers, messages, allowDemoBrain: false });
  check("e2e none: ok", c4.ok, c4.error);
  check("e2e none: no brain text", !seenSystem.includes("COGNITION LAYER") && !seenSystem.includes("SOUL.md"));

  server.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
