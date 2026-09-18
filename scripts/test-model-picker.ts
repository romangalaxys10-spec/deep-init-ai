/* Active-Brain chooser tests — "choose provider / model in Telegram and in
 * the web console menu (when more than is added under brains)".
 *
 * Covers the full vertical:
 *  1. providerKey / orderProviders — the shared ordering core
 *  2. /api/agent/config — Active-Brain passport (portal → gateway sync,
 *     stale-key self-healing, explicit clear)
 *  3. registry — the pick survives re-pairing (registerAgent)
 *  4. Telegram /model picker — buttons, ✅ marks, auto row, owner-only,
 *     unknown index, empty-registry note, /help + /status surface
 *  5. E2E chain order — two live mock providers; picking brain B in
 *     Telegram (mp callback) makes B answer first; auto restores A;
 *     a portal-side pick (config route) reaches the same chain.
 *
 * Run: npx tsx scripts/test-model-picker.ts
 */
import http from "http";
import { rmSync } from "fs";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/agent/config/route";
import { registerAgent, findAgentByOwner, findBoundAgent, bindChat } from "../src/lib/agent-registry";
import { providerKey, orderProviders, providerDisplayName } from "../src/lib/active-provider";
import { handleTelegramUpdate } from "../src/lib/telegram";

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

/* ---------------- stub the Telegram Bot API ---------------- */

interface TgCall {
  method: string;
  body: Record<string, unknown>;
}
const tgCalls: TgCall[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("api.telegram.org")) {
    const method = url.split("/bot")[1]?.split("/")[1] || "";
    let body: Record<string, unknown> = {};
    try {
      body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    } catch {
      body = {};
    }
    tgCalls.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

const callsOf = (method: string) => tgCalls.filter((c) => c.method === method);
const lastCall = (method: string) => callsOf(method).at(-1);

/* ---------------- mock brain providers (two distinct answerers) ---------------- */

function mockBrainServer(content: string): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url.startsWith("/v1/chat/completions") && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        void body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, base: `http://127.0.0.1:${addr.port}/v1` });
    });
  });
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/agent/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  /* isolation: the config route persists the dev registry file
   * (.gateway/registry.json); a stale file from a previous run would
   * re-hydrate old agents (with old activeProvider picks) into mem
   * before registration — purge it for a deterministic slate. */
  try {
    rmSync(".gateway/registry.json", { force: true });
  } catch {
    /* nothing to clean */
  }

  /* ── 1. shared ordering core ────────────────────────────────────────── */
  console.log("\n[1] providerKey / orderProviders");
  const A = { label: "Alpha", baseUrl: "http://a/v1", model: "model-a" };
  const B = { label: "Beta", baseUrl: "http://b/v1", model: "model-b" };
  const C = { label: "Gamma", baseUrl: "http://c/v1", model: "model-c" };
  const keyA = providerKey(A);
  check("1a. key format label::baseUrl::model", keyA === "alpha::http://a/v1::model-a", keyA);
  check("1b. key is case/whitespace-stable", providerKey({ label: " ALPHA ", baseUrl: " HTTP://A/V1 ", model: " Model-A " }) === keyA);
  check("1c. distinct providers → distinct keys", providerKey(B) !== keyA && providerKey(C) !== keyA);

  const chain = [{ ...A }, { ...B }, { ...C }];
  check("1d. no pick → priority order untouched", JSON.stringify(orderProviders(chain, null)) === JSON.stringify(chain));
  check("1e. empty key → untouched", JSON.stringify(orderProviders(chain, "")) === JSON.stringify(chain));
  check("1f. unknown key → untouched", JSON.stringify(orderProviders(chain, "nope::x::y")) === JSON.stringify(chain));
  check("1g. single provider → untouched", JSON.stringify(orderProviders([{ ...A }], keyA)) === JSON.stringify([{ ...A }]));

  const picked = orderProviders(chain, providerKey(B));
  check("1h. picked brain moves FIRST", providerKey(picked[0]) === providerKey(B), picked.map((p) => p.label).join(","));
  check("1i. rest keep relative order", providerKey(picked[1]) === keyA && providerKey(picked[2]) === providerKey(C));
  check("1j. original array not mutated (same length + members)",
    chain.length === 3 && chain.map((p) => p.label).join(",") === "Alpha,Beta,Gamma",
    JSON.stringify(chain.map((p) => p.label)));
  check("1k. displayName merges label+model", providerDisplayName(A) === "Alpha · model-a", providerDisplayName(A));
  check("1l. displayName falls back to model", providerDisplayName({ baseUrl: "x", model: "only-model" }) === "only-model");

  /* ── 2. config route — Active-Brain passport ────────────────────────── */
  console.log("\n[2] /api/agent/config — Active-Brain passport");
  const OWNER = "owner-model-picker-test";
  const provSeed = [
    { id: "seed-a", label: "Alpha", baseUrl: "http://a/v1", apiKey: "ka", model: "model-a", compat: "openai" as const },
    { id: "seed-b", label: "Beta", baseUrl: "http://b/v1", apiKey: "kb", model: "model-b", compat: "openai" as const },
  ];
  registerAgent({
    key: "k-model-picker",
    botToken: "12345:MODELPICKER",
    builtIn: false,
    agentName: "ChooserBot",
    ownerName: "Tester",
    ownerToken: OWNER,
    systemPrompt: "test prompt for chooser",
    providers: [],
    allowDemoBrain: false,
    whitelist: [],
  });

  const r0 = await POST(req({ ownerToken: OWNER, providers: provSeed }));
  const d0 = await r0.json();
  check("2a. providers seeded, active = null", d0.ok && d0.activeProvider === null, JSON.stringify(d0.activeProvider));

  const keyB = providerKey(provSeed[1]);
  const r1 = await POST(req({ ownerToken: OWNER, activeProvider: keyB }));
  const d1 = await r1.json();
  check("2b. valid pick persisted + echoed", d1.ok && d1.activeProvider === keyB, JSON.stringify(d1.activeProvider));
  check("2c. pick stored on the gateway agent", findAgentByOwner(OWNER)?.activeProvider === keyB);

  const r2 = await POST(req({ ownerToken: OWNER, activeProvider: "ghost::nowhere::void" }));
  const d2 = await r2.json();
  check("2d. unknown key cleared (lenient, ok:true)", d2.ok && d2.activeProvider === null, JSON.stringify(d2.activeProvider));

  await POST(req({ ownerToken: OWNER, activeProvider: keyB }));
  const r3 = await POST(req({ ownerToken: OWNER, activeProvider: null }));
  const d3 = await r3.json();
  check("3a. explicit null clears the pick", d3.ok && d3.activeProvider === null);

  await POST(req({ ownerToken: OWNER, activeProvider: keyB }));
  // provider push that KEEPS Beta → pick survives
  await POST(req({ ownerToken: OWNER, providers: [...provSeed] }));
  check("3b. provider re-push keeps a still-valid pick", findAgentByOwner(OWNER)?.activeProvider === keyB);
  // provider push that DROPS Beta → self-heal to auto
  const r4 = await POST(req({ ownerToken: OWNER, providers: [provSeed[0]] }));
  const d4 = await r4.json();
  check("3c. removing the picked provider self-heals to auto", d4.ok && d4.activeProvider === null && findAgentByOwner(OWNER)?.activeProvider === undefined);

  /* ── 4. registry — pick survives re-pairing ─────────────────────────── */
  console.log("\n[4] registry preservation across re-pairing");
  const pre = findAgentByOwner(OWNER)!;
  await POST(req({ ownerToken: OWNER, providers: provSeed, activeProvider: keyB }));
  registerAgent({
    key: "k-model-picker",
    botToken: "12345:MODELPICKER",
    builtIn: false,
    agentName: "ChooserBot",
    ownerName: "Tester",
    ownerToken: OWNER,
    systemPrompt: "test prompt for chooser",
    providers: provSeed, // pairing-time snapshot
    allowDemoBrain: false,
    whitelist: [],
  });
  check("4a. re-pairing preserves the active-brain pick", findAgentByOwner(OWNER)?.activeProvider === keyB, findAgentByOwner(OWNER)?.activeProvider);
  check("4b. pre-state was set before re-register", pre.activeProvider === keyB);

  /* ── 5. Telegram /model picker (stubbed Bot API) ────────────────────── */
  console.log("\n[5] Telegram /model picker");
  const { server: serverA, base: baseA } = await mockBrainServer("ANSWER_FROM_ALPHA");
  const { server: serverB, base: baseB } = await mockBrainServer("ANSWER_FROM_BETA");
  const gwProviders = [
    { id: "pa", label: "Alpha", baseUrl: baseA, apiKey: "", model: "model-a", compat: "openai" as const },
    { id: "pb", label: "Beta", baseUrl: baseB, apiKey: "", model: "model-b", compat: "openai" as const },
  ];
  const agent = registerAgent({
    key: "tg:model-picker",
    botToken: "111111111:TEST_model_picker_token",
    builtIn: true,
    agentName: "Chooser",
    ownerName: "Tester",
    ownerToken: "DIP-MODEL-TEST",
    systemPrompt: "test",
    providers: gwProviders,
    allowDemoBrain: false,
    whitelist: [],
  });
  const botToken = agent.botToken;
  bindChat(agent, 4242, { mode: "owner", userName: "Tester", token: "DIP-MODEL-TEST" });
  bindChat(agent, 5151, { mode: "shared", userName: "Guest", token: "DIP-GUEST-TOK" });

  tgCalls.length = 0;
  const outCmd = await handleTelegramUpdate({ update_id: 1, message: { message_id: 10, chat: { id: 4242, type: "private" }, text: "/model", date: 1 } }, botToken);
  check("5a. /model handled as hint", outCmd.handled === "hint", JSON.stringify(outCmd));
  const pickerMsg = lastCall("sendMessage");
  check("5b. picker message sent", Boolean(pickerMsg) && String(pickerMsg!.body.text).includes("Brains — which provider/model answers"), pickerMsg?.body.text as string);
  const mk1 = pickerMsg!.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
  const flat = mk1.inline_keyboard.flat();
  check("5c. one button per provider + auto row", flat.length === 3, JSON.stringify(flat));
  check("5d. buttons carry mp:<idx> callbacks", flat[0].callback_data === "mp:0" && flat[1].callback_data === "mp:1");
  check("5e. auto row marked ✅ when no pick", flat[2].text.includes("Auto (priority order) ✅"), flat[2].text);
  check("5f. provider names in buttons", flat[0].text.includes("Alpha") && flat[1].text.includes("Beta"));

  const outAlias = await handleTelegramUpdate({ update_id: 2, message: { message_id: 11, chat: { id: 4242, type: "private" }, text: "/models", date: 1 } }, botToken);
  check("5g. /models alias also opens the picker", outAlias.handled === "hint" && callsOf("sendMessage").length >= 2);

  // owner taps brain B (idx 1)
  tgCalls.length = 0;
  const outPick = await handleTelegramUpdate(
    { update_id: 3, callback_query: { id: "cb-mp1", from: { id: 1 }, message: { message_id: 777, chat: { id: 4242 } }, data: "mp:1" } },
    botToken
  );
  check("5h. tap handled", outPick.handled === "hint", JSON.stringify(outPick));
  check("5i. activeProvider stored as providerKey(B)", agent.activeProvider === providerKey({ label: "Beta", baseUrl: baseB, model: "model-b" }), agent.activeProvider);
  const toast1 = callsOf("answerCallbackQuery").find((c) => c.body.callback_query_id === "cb-mp1");
  check("5j. toast names the new active brain", Boolean(toast1) && String(toast1!.body.text).includes("Beta"), toast1?.body.text as string);
  const reRender = lastCall("editMessageText");
  const mk2 = reRender?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined;
  const flat2 = mk2?.inline_keyboard.flat() ?? [];
  check("5k. picker re-rendered with ✅ on Beta", flat2.some((b) => b.callback_data === "mp:1" && b.text.includes("✅")), JSON.stringify(flat2));
  check("5l. auto row no longer ✅", flat2.some((b) => b.callback_data === "mp:auto" && !b.text.includes("✅")), JSON.stringify(flat2));

  // unknown index rejected
  tgCalls.length = 0;
  await handleTelegramUpdate(
    { update_id: 4, callback_query: { id: "cb-mp99", from: { id: 1 }, message: { message_id: 777, chat: { id: 4242 } }, data: "mp:99" } },
    botToken
  );
  const toast99 = callsOf("answerCallbackQuery").find((c) => c.body.callback_query_id === "cb-mp99");
  check("5m. unknown index → honest toast", Boolean(toast99) && String(toast99!.body.text).includes("no longer exist"), toast99?.body.text as string);

  // non-owner denied
  tgCalls.length = 0;
  await handleTelegramUpdate(
    { update_id: 5, callback_query: { id: "cb-guest", from: { id: 2 }, message: { message_id: 778, chat: { id: 5151 } }, data: "mp:0" } },
    botToken
  );
  const toastGuest = callsOf("answerCallbackQuery").find((c) => c.body.callback_query_id === "cb-guest");
  check("5n. non-owner tap denied", Boolean(toastGuest) && String(toastGuest!.body.text).includes("owner"), toastGuest?.body.text as string);

  // non-owner /model command denied
  tgCalls.length = 0;
  const outGuestCmd = await handleTelegramUpdate({ update_id: 6, message: { message_id: 12, chat: { id: 5151, type: "private" }, text: "/model", date: 1 } }, botToken);
  const guestMsg = lastCall("sendMessage");
  check("5o. non-owner /model denied with a friendly note", outGuestCmd.handled === "hint" && Boolean(guestMsg) && String(guestMsg!.body.text).includes("owner"), guestMsg?.body.text as string);
  check("5p. pick survived the denied attempts", agent.activeProvider === providerKey({ label: "Beta", baseUrl: baseB, model: "model-b" }));

  // /status + /help surface
  tgCalls.length = 0;
  await handleTelegramUpdate({ update_id: 7, message: { message_id: 13, chat: { id: 4242, type: "private" }, text: "/status", date: 1 } }, botToken);
  const statusMsg = lastCall("sendMessage");
  check("5q. /status shows the active brain", Boolean(statusMsg) && String(statusMsg!.body.text).includes("Active brain: Beta"), statusMsg?.body.text as string);

  tgCalls.length = 0;
  await handleTelegramUpdate({ update_id: 8, message: { message_id: 14, chat: { id: 4242, type: "private" }, text: "/help", date: 1 } }, botToken);
  const helpMsg = lastCall("sendMessage");
  check("5r. /help advertises /model", Boolean(helpMsg) && String(helpMsg!.body.text).includes("/model"), helpMsg?.body.text as string);

  // empty registry note (fresh agent, no providers)
  const agentEmpty = registerAgent({
    key: "tg:model-picker-empty",
    botToken: "222222222:TEST_model_picker_empty",
    builtIn: true,
    agentName: "Bare",
    ownerName: "Tester",
    ownerToken: "DIP-MODEL-EMP",
    systemPrompt: "test",
    providers: [],
    allowDemoBrain: true,
    whitelist: [],
  });
  bindChat(agentEmpty, 4343, { mode: "owner", userName: "Tester", token: "DIP-MODEL-EMP" });
  tgCalls.length = 0;
  await handleTelegramUpdate({ update_id: 9, message: { message_id: 15, chat: { id: 4343, type: "private" }, text: "/model", date: 1 } }, agentEmpty.botToken);
  const emptyMsg = lastCall("sendMessage");
  check("5s. no providers → demo-brain note instead of an empty picker", Boolean(emptyMsg) && String(emptyMsg!.body.text).includes("demo brain"), emptyMsg?.body.text as string);

  /* ── 6. E2E — the picked brain ACTUALLY answers first ───────────────── */
  console.log("\n[6] e2e chain order — picked brain answers first");
  tgCalls.length = 0;
  const outChat1 = await handleTelegramUpdate(
    { update_id: 10, message: { message_id: 16, chat: { id: 4242, type: "private" }, text: "hello there", date: 1 } },
    botToken
  );
  check("6a. chat handled", outChat1.handled === "chat" && outChat1.replyPreview !== undefined, JSON.stringify(outChat1));
  check("6b. BETA answers first after the mp:1 pick", Boolean(outChat1.replyPreview?.includes("ANSWER_FROM_BETA")), outChat1.replyPreview);

  // auto restores priority order (Alpha first)
  tgCalls.length = 0;
  await handleTelegramUpdate(
    { update_id: 11, callback_query: { id: "cb-auto", from: { id: 1 }, message: { message_id: 777, chat: { id: 4242 } }, data: "mp:auto" } },
    botToken
  );
  check("6c. auto pick cleared activeProvider", agent.activeProvider === undefined);
  const outChat2 = await handleTelegramUpdate(
    { update_id: 12, message: { message_id: 17, chat: { id: 4242, type: "private" }, text: "hello again", date: 1 } },
    botToken
  );
  check("6d. ALPHA answers first in auto mode", Boolean(outChat2.replyPreview?.includes("ANSWER_FROM_ALPHA")), outChat2.replyPreview);

  // portal-side pick reaches the same Telegram chain (Active-Brain passport)
  // findAgentByOwner("DIP-MODEL-TEST") → the tg:model-picker agent (the only
  // agent holding this owner token after the startup purge)
  const ownerOwnerToken = "DIP-MODEL-TEST";
  const ragent = findAgentByOwner(ownerOwnerToken)!;
  check("6e0. portal lookup resolves the chain agent", ragent === agent, ragent?.key);

  const r5 = await POST(req({ ownerToken: ownerOwnerToken, activeProvider: providerKey({ label: "Beta", baseUrl: baseB, model: "model-b" }) }));
  const d5 = await r5.json();
  check("6e. portal pick accepted", d5.ok && d5.activeProvider === providerKey({ label: "Beta", baseUrl: baseB, model: "model-b" }), JSON.stringify(d5.activeProvider));
  check("6f. gateway agent now holds the portal pick", ragent.activeProvider === providerKey({ label: "Beta", baseUrl: baseB, model: "model-b" }));
  tgCalls.length = 0;
  const outChat3 = await handleTelegramUpdate(
    { update_id: 13, message: { message_id: 18, chat: { id: 4242, type: "private" }, text: "portal pick test", date: 1 } },
    botToken
  );
  check("6g. PORTAL pick drives the Telegram chain (BETA first)", Boolean(outChat3.replyPreview?.includes("ANSWER_FROM_BETA")), outChat3.replyPreview);

  // fallback still works: point Beta's chain entry at a dead port
  ragent.providers = [
    { id: "pa", label: "Alpha", baseUrl: baseA, apiKey: "", model: "model-a", compat: "openai" as const },
    { id: "pb", label: "Beta", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", model: "model-b", compat: "openai" as const },
  ];
  const outChat4 = await handleTelegramUpdate(
    { update_id: 14, message: { message_id: 19, chat: { id: 4242, type: "private" }, text: "fallback check", date: 1 } },
    botToken
  );
  check("6h. dead ACTIVE brain falls back to ALPHA (never errors out)", Boolean(outChat4.replyPreview?.includes("ANSWER_FROM_ALPHA")), outChat4.replyPreview);

  serverA.close();
  serverB.close();

  console.log(`\n════════ model-picker: ${pass} passed · ${fail} failed ════════`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
