/* Provider Passport sync test — the "I added a custom provider but the bot
 * keeps telling me to add one" production bug.
 * Proves /api/agent/config now accepts providers and updates the gateway
 * agent that the Telegram webhook reads — without re-pairing.
 * Run: npx tsx scripts/test-provider-sync.ts
 */
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/agent/config/route";
import { registerAgent, findAgentByOwner } from "../src/lib/agent-registry";

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

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/agent/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  const OWNER = "owner-sync-test";
  registerAgent({
    key: "k-sync",
    botToken: "12345:SYNC",
    builtIn: false,
    agentName: "SyncBot",
    ownerName: "Tester",
    ownerToken: OWNER,
    systemPrompt: "test prompt for sync",
    providers: [], // ← paired BEFORE the user added any provider
    allowDemoBrain: true,
    whitelist: [],
  });
  check("agent registered with empty providers", findAgentByOwner(OWNER)?.providers.length === 0);

  // the portal push that used to be impossible: providers added AFTER pairing
  const res = await POST(req({
    ownerToken: OWNER,
    providers: [
      { label: "My Custom Brain", baseUrl: "https://api.openai-compatible.example/v1", apiKey: "sk-test", model: "gpt-x", compat: "openai" },
      { label: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "ak-test", model: "claude-x", compat: "anthropic" },
      { baseUrl: "", model: "", apiKey: "" }, // invalid → filtered out
    ],
  }));
  const data = await res.json();
  check("route returns ok", res.status === 200 && data.ok === true, JSON.stringify(data).slice(0, 140));
  check("providers persisted on the gateway agent", findAgentByOwner(OWNER)?.providers.length === 2, JSON.stringify(findAgentByOwner(OWNER)?.providers));
  check("response echoes the providers", Array.isArray(data.providers) && data.providers.length === 2);

  const agent = findAgentByOwner(OWNER)!;
  check("order preserved (fallback chain semantics)", agent.providers[0].model === "gpt-x" && agent.providers[1].model === "claude-x");
  check("compat flag preserved", agent.providers[1].compat === "anthropic");
  check("credentials stored for gateway use", agent.providers[0].apiKey === "sk-test");

  // removal + reorder flow
  const res2 = await POST(req({ ownerToken: OWNER, providers: [{ label: "Only", baseUrl: "https://x/v1", apiKey: "k", model: "m2", compat: "openai" }] }));
  const data2 = await res2.json();
  check("provider update replaces the set", data2.ok && findAgentByOwner(OWNER)?.providers.length === 1 && findAgentByOwner(OWNER)?.providers[0].model === "m2");

  // invalid payload → 400, agent untouched
  const res3 = await POST(req({ ownerToken: OWNER, providers: "not-an-array" }));
  check("non-array providers rejected", res3.status === 400);
  check("agent providers untouched on 400", findAgentByOwner(OWNER)?.providers[0].model === "m2");

  console.log(`\n════════ provider-sync: ${pass} passed · ${fail} failed ════════`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
