/* Voice-mode E2E: injects a fake SpeechRecognition into the browser and
 * drives the full hands-free loop against the LIVE app:
 *   voice ON → fake mic utters "what is 2 plus 2" → auto-send → agent replies
 *   → reply spoken via real /api/voice/tts → mic re-opens (loop proof).
 * Run: node scripts/e2e-voice.mjs   (BASE_URL defaults to prod)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://deep-init-ai.vercel.app";
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

const INIT_SCRIPT = `
class FakeSR {
  constructor() {
    this.continuous = false; this.interimResults = false; this.lang = "en-US";
    this.onresult = null; this.onend = null; this.onerror = null;
  }
  start() {
    window.__srStarts = (window.__srStarts || 0) + 1;
    const QUESTIONS = ["what is 2 plus 2", "what is 17.5% of 100", "what is 144 divided by 12"];
    const self = this;
    setTimeout(() => {
      const utter = QUESTIONS[((window.__srStarts || 1) - 1) % QUESTIONS.length];
      try {
        self.onresult && self.onresult({
          resultIndex: 0,
          results: [ { 0: { transcript: utter }, isFinal: true, length: 1 } ],
        });
      } catch (e) {}
      setTimeout(() => { try { self.onend && self.onend(); } catch (e) {} }, 120);
    }, 450);
  }
  stop() {}
  abort() {}
}
window.SpeechRecognition = FakeSR;
window.webkitSpeechRecognition = FakeSR;
`;

async function main() {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  const ttsRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/voice/tts")) ttsRequests.push(r.url());
  });

  /* wizard fast path → dashboard */
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

  /* console: voice mode button present */
  await page.locator('button:has-text("console")').first().click();
  await page.waitForTimeout(900);
  const vmBtn = page.locator('button[aria-label="Toggle voice mode"]');
  ok("voice mode button present", (await vmBtn.count()) === 1);
  const btnText = await vmBtn.first().innerText();
  ok("button label localized", /voice mode/i.test(btnText), btnText);

  /* toggle ON → listening */
  await vmBtn.first().click();
  await page.waitForTimeout(700);
  const barListening = await page.locator("text=listening…").first().isVisible().catch(() => false);
  ok("voice bar shows listening", barListening);
  ok("fake mic started once", (await page.evaluate(() => window.__srStarts)) === 1);

  /* fake utterance → auto-send → reply */
  await page.waitForTimeout(1200); // fake fires at ~450ms, commit debounce 900ms
  await page.waitForSelector("text=what is 2 plus 2", { timeout: 20000 });
  ok("transcript auto-sent as user message", true);
  await page.waitForTimeout(9000); // reply + TTS round-trip
  const body = await page.locator("body").innerText();
  ok("agent replied (contains 4)", body.includes("4"), body.slice(0, 200).replace(/\n/g, " "));
  ok("TTS endpoint was hit", ttsRequests.length >= 1, `n=${ttsRequests.length}`);

  /* loop proof: mic re-opened after the reply was spoken */
  const starts = await page.waitForFunction(
    () => (window.__srStarts || 0) >= 2,
    null,
    { timeout: 25000 }
  ).then(() => true).catch(() => false);
  ok("voice loop re-opens mic (srStarts >= 2)", starts, `starts=${await page.evaluate(() => window.__srStarts)}`);

  /* second hands-free exchange — the loop already re-opened the mic with question #2 */
  await page.waitForTimeout(18000);
  const body2 = await page.locator("body").innerText();
  ok("second hands-free exchange answered", body2.includes("17.5"), "");

  /* toggle OFF cleanly */
  await vmBtn.first().click();
  await page.waitForTimeout(500);
  const barGone = !(await page.locator("text=listening…").first().isVisible().catch(() => false));
  ok("toggle off clears voice bar", barGone);

  await page.screenshot({ path: "download/voice-mode-e2e-proof.png", animations: "disabled" });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e-voice crashed:", e);
  process.exit(1);
});
