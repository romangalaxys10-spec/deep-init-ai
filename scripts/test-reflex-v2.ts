/* Reflex v2 tests — the offline reflex tier after the production bugs:
 *   B1. extractReflexContext: synthetic engine messages ([AUTOMATED TOOL
 *       RESULTS…], nudge) are NEVER picked as the user's text — the exact
 *       "I heard you: '[AUTOMATED TOOL RESULTS…]" screenshot bug
 *   B2. tool results are surfaced so the reflex answers from REAL data
 *   B3. provider-aware note: when the user HAS a provider the note stops
 *       saying "add your own provider key" and names the failure instead
 *   B4. no-provider note keeps the original BYO guidance
 *   B5. canned reflexes (math / time / greeting) still work
 *   B6. end-to-end: runAgentChainStreaming with a provider that answers
 *       with tool syntax once then dies → the final answer NEVER contains
 *       the [AUTOMATED TOOL RESULTS] echo
 * Run: npx tsx scripts/test-reflex-v2.ts
 */
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { extractReflexContext, runAgentChainStreaming, NUDGE_MARKER } from "../src/lib/brain";
import { TOOL_RESULTS_MARKER, executeToolCalls } from "../src/lib/tools";
import { reflexReply } from "../src/lib/reflex-brain";

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

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function main() {
  /* ── B1. synthetic messages are never "the user" ───────────────────── */
  console.log("\nB1. extractReflexContext — skip engine plumbing");
  const feedback = await executeToolCalls([
    { name: "web_fetch", params: { url: "https://www.dedicatednodes.io" } },
  ]);
  const messages: Msg[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "fetch dedicatednodes.io and summarize" },
    { role: "assistant", content: "<function=web_fetch>\n<parameter=url>https://www.dedicatednodes.io</parameter>\n</function>" },
    { role: "user", content: feedback },
    { role: "assistant", content: "<function=web_search>" },
    { role: "user", content: `${NUDGE_MARKER}. Answer now.` },
  ];
  const ctx = extractReflexContext(messages);
  check("B1a. real user text recovered", ctx.userText === "fetch dedicatednodes.io and summarize", JSON.stringify(ctx.userText));
  check("B1b. tool results captured separately", ctx.toolResults.startsWith(TOOL_RESULTS_MARKER) && ctx.toolResults.includes("web_fetch"), ctx.toolResults.slice(0, 120));
  check("B1c. reflex would echo NEITHER marker", !ctx.userText.includes(TOOL_RESULTS_MARKER) && !ctx.userText.includes(NUDGE_MARKER), ctx.userText);

  /* ── B2. tool-results-aware reflex answer ──────────────────────────── */
  console.log("\nB2. reflexReply uses real tool output");
  const toolAnswer = reflexReply("whatever", {
    toolResults: feedback,
  });
  check("B2a. quotes the gathered material", toolAnswer.content.includes("web_fetch") && toolAnswer.content.includes("dedicatednodes"), toolAnswer.content.slice(0, 160));
  check("B2b. no 'I heard you' echo", !toolAnswer.content.includes("I heard you"), toolAnswer.content.slice(0, 160));
  check("B2c. header stripped from the quoted block", !toolAnswer.content.includes("AUTOMATED TOOL RESULTS"), toolAnswer.content.slice(0, 160));

  /* ── B3. provider-aware degraded note ──────────────────────────────── */
  console.log("\nB3. provider-aware note (the 'I added a provider!' report)");
  const degraded = reflexReply("what is their cheapest plan?", {
    hasProviders: true,
    providerError: "HTTP 401: invalid api key",
  });
  check("B3a. stops telling the user to add a key", !degraded.content.includes("add your own provider key"), degraded.content);
  check("B3b. names the actual error", degraded.content.includes("HTTP 401"), degraded.content);
  check("B3c. says degraded mode", degraded.content.includes("Degraded mode"), degraded.content);

  /* ── B4. no-provider note unchanged in spirit ──────────────────────── */
  const plain = reflexReply("what is their cheapest plan?");
  check("B4a. still guides BYOK when nothing is wired", plain.content.includes("add your own provider key"), plain.content.slice(-260));
  check("B4b. honest fallback still says 'I heard you'", plain.content.includes("I heard you"), plain.content.slice(0, 120));

  /* ── B5. canned reflexes intact ────────────────────────────────────── */
  check("B5a. math still answered", reflexReply("17.5% of 2_384 * 12").content.includes("5006.4"), reflexReply("17.5% of 2_384 * 12").content);
  check("B5b. greeting still answered", reflexReply("hi").content.includes("offline reflex tier"));
  check("B5c. time still answered", /UTC/.test(reflexReply("time").content));

  /* ── B6. end-to-end streaming: provider dies mid-tool-loop ─────────── */
  console.log("\nB6. streaming chain — provider answers with tool syntax, then dies");
  const seenBodies: string[] = [];
  const mp = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seenBodies.push(Buffer.concat(chunks).toString("utf8"));
      if (seenBodies.length === 1) {
        // round 1: tool-call syntax as text (leaks like prod)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "<function=web_search>\n<parameter=query>cpu price</parameter>\n</function>" } }],
        }));
      } else {
        // round 2+: provider is dead
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "quota exceeded" } }));
      }
    });
  });
  await new Promise<void>((resolve) => mp.listen(0, "127.0.0.1", resolve));
  const port = (mp.address() as AddressInfo).port;

  const result = await runAgentChainStreaming({
    providers: [{ label: "mock-custom", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "k", model: "test-model", compat: "openai" }],
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "search cpu price and tell me" },
    ],
    allowDemoBrain: true,
  });
  const out = result.content || "";
  check("B6a. answer produced despite the dead provider", result.ok && out.length > 0, `ok=${result.ok} via=${result.via}`);
  check("B6b. NO tool-results echo in the answer", !out.includes("AUTOMATED TOOL RESULTS"), out.slice(0, 200));
  check("B6c. NO raw nudge marker in the answer", !out.includes(NUDGE_MARKER), out.slice(0, 200));
  check("B6d. substantive non-plumbing answer (reflex or demo brain)", out.length > 80 && !out.includes("I heard you: “[AUTOMATED"), out.slice(0, 200));

  mp.close();
  console.log(`\n════════ reflex v2: ${pass} passed · ${fail} failed ════════`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
