/* Duplicate-reply fix proof — run with: npx tsx scripts/test-dup-fix.ts
 *
 * Reproduces the prod bug deterministically and proves the fix:
 *  1. a fast reply (offline reflex) streams ONE delta → the surface claim
 *     (draft → placeholder) is still in flight when the stream ends
 *  2. OLD code: final send + late placeholder = the reply arrives TWICE
 *     NEW code: final send awaits the claim → exactly ONE message
 *  3. redelivered update_ids (webhook retries / poll overlap) are dropped
 *
 * The demo brain is forced onto the offline reflex tier by pointing
 * ZAI_BASE_URL at a dead local port; Telegram API calls are intercepted
 * with a mocked fetch that simulates real round-trip latency.
 */
import fs from "fs";

/* ---- force the demo brain onto the offline reflex tier BEFORE any call ---- */
process.env.ZAI_API_KEY = "forced-unreachable";
process.env.ZAI_BASE_URL = "http://127.0.0.1:9";
try {
  fs.rmSync("/tmp/.z-ai-config", { force: true });
} catch {
  /* nothing to clean */
}

/* ---- mock the Telegram Bot API before the gateway runs ---- */
type Call = { method: string; body: Record<string, unknown> };
const sent: Call[] = [];
const edits: Call[] = [];
let messageIdSeq = 100;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const m = url.match(/bot[^/]+\/(\w+)/);
  if (!m) return realFetch(input as never, init);
  const method = m[1];
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (method === "sendMessage") {
    await new Promise((r) => setTimeout(r, 800)); // real-world Telegram RTT — the race window
    sent.push({ method, body });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: ++messageIdSeq, chat: body.chat_id ?? 0 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (method === "editMessageText") {
    await new Promise((r) => setTimeout(r, 20));
    edits.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  // sendMessageDraft (Bot API 9.5) and everything else: unsupported/fail
  await new Promise((r) => setTimeout(r, 30));
  return new Response(JSON.stringify({ ok: false, description: `${method} not supported in mock` }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

/* ---- gateway imports AFTER the env + fetch hooks are in place ---- */
import type { TelegramUpdate } from "../src/lib/telegram";
const { handleTelegramUpdate } = await import("../src/lib/telegram");
const { markUpdateSeen, registerAgent, bindChat } = await import("../src/lib/agent-registry");

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

const BOT = "123456:dupTestToken0000000000000";
const CHAT = 4242;

function msg(updateId: number, text: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 42, first_name: "Roman", language_code: "en" },
      chat: { id: CHAT, type: "private" },
      text,
      date: Math.floor(Date.now() / 1000),
    },
  };
}

async function main() {
  const agent = registerAgent({
    key: "dup-test",
    botToken: BOT,
    builtIn: true,
    agentName: "Init",
    ownerName: "Roman",
    ownerToken: "di_testowner",
    systemPrompt: "You are a test agent.",
    providers: [],
    allowDemoBrain: true,
    whitelist: [],
  });
  bindChat(agent, CHAT, { mode: "owner", userName: "Roman", token: "di_testowner" });

  /* 1) first chat message — the one that used to be answered twice.
   *    Route semantics: ledger check, then handle. */
  check("ledger accepts update 1001", markUpdateSeen(BOT, 1001) === true);
  const out1 = await handleTelegramUpdate(msg(1001, "hi"), BOT);
  check("first update handled as chat", out1.handled === "chat", out1.handled);
  check(
    "EXACTLY ONE sendMessage for the reply (dup fix)",
    sent.length === 1,
    `sent=${sent.length}: [${sent.map((s) => String(s.body.text).slice(0, 30)).join(" | ")}]`
  );
  check("final content arrived via edit", edits.length >= 1, `edits=${edits.length}`);
  check(
    "no duplicate text across messages",
    sent.length === new Set(sent.map((s) => String(s.body.text))).size
  );

  /* 2) redelivered update (Telegram retry / poll overlap) — dropped by ledger */
  check("ledger drops redelivery of 1001", markUpdateSeen(BOT, 1001) === false);
  const sentBefore = sent.length;
  check("ledger accepts fresh id 1002", markUpdateSeen(BOT, 1002) === true);

  /* 3) a second, different utterance still answers exactly once */
  const out3 = await handleTelegramUpdate(msg(1003, "what is 17.5% of 100"), BOT);
  check("second utterance handled", out3.handled === "chat", out3.handled);
  check(
    "second reply also exactly ONE message",
    sent.length === sentBefore + 1,
    `sent=${sent.length} expected=${sentBefore + 1}`
  );
  check(
    "math answer contains 17.5",
    /17\.5/.test(out3.replyPreview || ""),
    out3.replyPreview?.slice(0, 80)
  );

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
