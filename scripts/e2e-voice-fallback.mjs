/* Voice-mode FALLBACK e2e — run: node scripts/e2e-voice-fallback.mjs [BASE_URL]
 *
 * Simulates a browser where SpeechRecognition exists but its vendor speech
 * servers are unreachable (every start() → onerror 'network'). Voice mode
 * must auto-escalate to the compat capture engine (PCM mic → /api/voice/stt)
 * and KEEP the hands-free session alive.
 * Chromium's --use-fake-device-for-media-stream supplies a synthetic audio
 * stream so getUserMedia succeeds headlessly (constant tone → VAD arms →
 * 15s cap commits → STT POST → likely empty transcript → mic reopens).
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:3000";
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const FAILING_SR = `
class DeadSR {
  constructor() {
    this.continuous = false; this.interimResults = false; this.lang = "en-US";
    this.onresult = null; this.onend = null; this.onerror = null;
  }
  start() {
    window.__srStarts = (window.__srStarts || 0) + 1;
    const self = this;
    setTimeout(() => {
      try { self.onerror && self.onerror({ error: "network" }); } catch (e) {}
      try { self.onend && self.onend(); } catch (e) {}
    }, 120);
  }
  stop() {}
  abort() {}
}
window.SpeechRecognition = DeadSR;
window.webkitSpeechRecognition = DeadSR;
`;

async function main() {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(FAILING_SR);
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  let sttRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/voice/stt") && r.method() === "POST") sttRequests++;
  });

  /* wizard fast path → dashboard (same as e2e-voice) */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator("text=Initialize your agent").first().click();
  await page.waitForTimeout(1000);
  await page.locator("#displayName").fill("Roman");
  await page.locator("#agentName").fill("Init");
  await page.locator('button:has-text("Next: connect telegram")').click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Next: connect AI brains")').first().click();
  await page.waitForTimeout(800);
  await page
    .locator('button:has-text("Next: shape its behavior"), button:has-text("Skip — use demo brain")')
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Research & briefings")').first().click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Review & initialize")').click();
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("sudo init --agent")').click();
  await page.waitForSelector('button:has-text("cognition")', { timeout: 45000 });
  ok("wizard → dashboard", true);

  /* console → toggle voice mode */
  await page.locator('button:has-text("console")').first().click();
  await page.waitForTimeout(900);
  const vmBtn = page.locator('button[aria-label="Toggle voice mode"]');
  ok("voice mode button present", (await vmBtn.count()) === 1);

  await vmBtn.first().click();
  await page.waitForTimeout(2500); // DeadSR fails ~120ms → escalate → fake mic opens

  const barText = await page.evaluate(() => document.body.innerText);
  ok("session still listening after SR death", /listening…/i.test(barText), barText.slice(0, 0));
  ok("compat engine engaged (chip visible)", /compat capture/i.test(barText));
  ok("SR error escalated exactly once", await page.evaluate(() => window.__srStarts <= 2), `starts=${await page.evaluate(() => window.__srStarts)}`);

  /* fake device tone → VAD arms instantly → 15s cap commits → STT POST */
  console.log("== waiting for VAD commit + STT round-trip (≤22s) ==");
  const deadline = Date.now() + 22000;
  while (Date.now() < deadline && sttRequests === 0) await page.waitForTimeout(500);
  ok("POST /api/voice/stt fired", sttRequests >= 1, `requests=${sttRequests}`);

  /* after a tone-transcript the loop must RE-OPEN the mic, not die.
   * The STT round-trip on a cold lambda takes seconds — poll, don't sleep. */
  const resumed = await page
    .waitForFunction(
      () => /listening…/i.test(document.body.innerText) && !/thinking…/i.test(document.body.innerText),
      null,
      { timeout: 25000 }
    )
    .then(() => true)
    .catch(() => false);
  ok("loop resumed listening after empty transcript", resumed);
  const barAfter = await page.evaluate(() => document.body.innerText);
  ok("no error crash in UI", !/unsupportedTitle/i.test(barAfter));

  /* toggle off cleanly */
  await vmBtn.first().click();
  await page.waitForTimeout(600);
  const barGone = !(await page.evaluate(() => /compat capture/i.test(document.body.innerText)));
  ok("toggle off clears voice bar", barGone);

  await page.screenshot({ path: "download/voice-fallback-e2e-proof.png", animations: "disabled" });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e-voice-fallback crashed:", e);
  process.exit(1);
});
